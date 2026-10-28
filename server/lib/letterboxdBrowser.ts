import { getRepository } from '@server/datasource';
import { LetterboxdAccount } from '@server/entity/MovieReview';
import { User } from '@server/entity/User';
import PreparedEmail from '@server/lib/email';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  assessWriteHealth,
  checkBrowserHealth,
  completeReconciledExport,
  exchangeBrowserJob,
  observationHealthIssues,
  queueBrowserExports,
  queueBrowserScans,
  type BrowserState,
} from './letterboxdBrowserState';
import {
  maintainObservationHealth,
  readObservations,
  updateObservations,
} from './letterboxdObservations';
import { readWriteState } from './letterboxdWriteQueue';

const filename = () => path.join(appDataPath(), 'letterboxd-browser.json');
export function readBrowserState(): BrowserState {
  try {
    const state = JSON.parse(fs.readFileSync(filename(), 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.bindings))
      throw Error('Invalid browser state');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, bindings: [] };
    throw error;
  }
}
function updateBrowserState<T>(change: (state: BrowserState) => T): T {
  const state = readBrowserState();
  const result = change(state);
  const temp = filename() + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temp, filename());
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return result;
}
const digest = (token: string) => createHash('sha256').update(token).digest();
export function disableLetterboxdBrowser(userId: number) {
  updateBrowserState((state) => {
    const binding = state.bindings.find((b) => b.userId === userId);
    if (binding) binding.enabled = false;
  });
}
export function rotateBrowserToken() {
  const token = randomBytes(32).toString('base64url');
  updateBrowserState((state) => {
    state.tokenHash = digest(token).toString('hex');
  });
  return token;
}
export function browserTokenMatches(token: string) {
  const expected = readBrowserState().tokenHash;
  return (
    !!expected &&
    /^[a-f0-9]{64}$/.test(expected) &&
    timingSafeEqual(Buffer.from(expected, 'hex'), digest(token))
  );
}
export async function bindLetterboxdBrowser(
  userId: number,
  instance: string,
  enabled: boolean
) {
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(instance) ||
    typeof enabled !== 'boolean'
  )
    throw Error('Invalid binding');
  const account = await getRepository(LetterboxdAccount).findOne({
    where: { userId },
  });
  if (!account?.enabled) throw Error('Link a Letterboxd account first');
  updateBrowserState((state) => {
    if (
      state.bindings.some(
        (row) => row.instance === instance && row.userId !== userId
      )
    )
      throw Error('Browser already bound');
    const existing = state.bindings.find((row) => row.userId === userId);
    if (
      existing &&
      (existing.instance !== instance || existing.username !== account.username)
    )
      throw Error('Disable and reconcile the old binding before replacing it');
    if (existing) existing.enabled = enabled;
    else
      state.bindings.push({
        userId,
        username: account.username,
        instance,
        enabled,
      });
    queueBrowserScans(state, Date.now());
  });
}
export async function browserExchange(
  instance: string,
  report: unknown,
  exportCapable = false
) {
  const binding = readBrowserState().bindings.find(
    (row) => row.instance === instance
  );
  if (!binding) throw Error('Browser not bound');
  const account = await getRepository(LetterboxdAccount).findOne({
    where: { userId: binding.userId },
  });
  if (!account?.enabled || account.username !== binding.username)
    throw Error('Letterboxd mapping changed');
  updateBrowserState((state) => {
    const row = state.bindings.find((b) => b.instance === instance)!;
    row.exportCapable = exportCapable;
    row.lastSeen = Date.now();
  });
  if (binding.job?.kind === 'export' && report && typeof report === 'object') {
    const result = report as {
      id?: string;
      outcome?: string;
      identity?: string;
      complete?: boolean;
      encoded?: string;
      capturedAt?: number;
      items?: unknown;
    };
    if (result.id !== binding.job.id) throw Error('Unexpected export report');
    if (result.outcome === 'succeeded' && binding.job.state !== 'succeeded') {
      if (
        binding.job.state !== 'running' ||
        result.identity !== account.username ||
        result.complete !== true ||
        typeof result.encoded !== 'string' ||
        !Number.isFinite(result.capturedAt) ||
        result.capturedAt! < binding.job.created ||
        result.capturedAt! > Date.now() + 60000
      )
        throw Error('Unverified export report');
      const { stageExport } = await import('./letterboxdExportInbox');
      const { readExportSnapshot } = await import('./letterboxdExportSnapshot');
      await readExportSnapshot(result.encoded, account.username);
      // Archive validation yields: another exchange may finish this job meanwhile.
      const latest = readBrowserState().bindings.find(
        (b) => b.instance === instance
      );
      if (
        !latest?.enabled ||
        latest.username !== account.username ||
        latest.job?.id !== result.id
      )
        throw Error('Export binding changed');
      if (
        latest.job.state === 'succeeded' &&
        latest.lastCompletedJobId === result.id
      )
        return { action: 'idle' as const };
      if (latest.job.state !== 'running') throw Error('Export job changed');
      stageExport(instance, {
        id: result.id,
        userId: binding.userId,
        account: account.username,
        capturedAt: result.capturedAt!,
        encoded: result.encoded,
      });
    }
  }
  if (binding.job?.kind === 'export' && binding.job.state === 'running') {
    const { resumeExport } = await import('./letterboxdExportInbox');
    const staged = resumeExport(
      instance,
      async (delivery) => {
        if (
          delivery.id !== binding.job!.id ||
          delivery.account !== account.username ||
          delivery.userId !== binding.userId
        )
          throw Error('Export binding changed');
        const completed = updateBrowserState((state) => {
          const current = state.bindings.find((b) => b.instance === instance);
          if (
            current?.enabled &&
            current.username === delivery.account &&
            current.job?.id === delivery.id &&
            current.job.state === 'succeeded' &&
            current.lastCompletedJobId === delivery.id
          )
            return true;
          if (
            current?.job?.id !== delivery.id ||
            current.job.state !== 'running'
          )
            throw Error('Export job changed');
          current.job.reconciliationStartedAt ??= Date.now();
          return false;
        });
        if (completed) return;
        const { reconcileExport } =
          await import('./letterboxdExportReconciliation');
        await reconcileExport(
          delivery.userId,
          delivery.account,
          delivery.id,
          delivery.capturedAt,
          delivery.encoded
        );
        // The preview must never turn a successful core reconciliation into a failure.
        try {
          const { enqueueDiscoveryExport } =
            await import('./discoveryImportInbox');
          await enqueueDiscoveryExport(delivery);
        } catch (error) {
          logger.warn('Discovery list import retained its previous snapshot', {
            label: 'Discovery lists',
            userId: delivery.userId,
          });
        }
        updateBrowserState((state) => {
          completeReconciledExport(
            state,
            instance,
            delivery.id,
            delivery.account,
            Date.now()
          );
        });
      },
      (id, detail) =>
        updateBrowserState((state) => {
          const current = state.bindings.find((b) => b.instance === instance)!;
          if (current?.job?.id === id && current.job.state === 'running') {
            current.job.state = 'blocked';
            current.issue = 'verification';
            current.job.reconciliationError = detail;
          }
        })
    );
    if (staged) return { action: 'idle' as const };
  }
  return updateBrowserState((state) =>
    exchangeBrowserJob(state, instance, report, Date.now())
  );
}
// The machine launcher may inspect queued work without pretending the browser is alive.
export async function browserPending(instance: string) {
  const binding = readBrowserState().bindings.find(
    (row) => row.instance === instance && row.enabled
  );
  if (!binding || (binding.issue && binding.issue !== 'offline'))
    return { pending: false };
  const account = await getRepository(LetterboxdAccount).findOne({
    where: { userId: binding.userId },
  });
  if (!account?.enabled || account.username !== binding.username)
    return { pending: false };
  if (binding.job?.state === 'queued')
    return { pending: true, id: binding.job.id, account: binding.username };
  const writes = readWriteState();
  const setting = writes.settings[binding.userId];
  if (setting?.enabled && setting.account === binding.username) {
    // The machine launcher must see freshly saved work even with Edge closed.
    // Admission is bounded/debounced and does not itself perform remote writes.
    const { prepareLetterboxdPublications } =
      await import('./letterboxdPublicationContinuation');
    await prepareLetterboxdPublications();
    const { prepareLetterboxdPlaybackPublications } =
      await import('./letterboxdPlaybackContinuation');
    await prepareLetterboxdPlaybackPublications();
    const observation = readObservations().requests.find(
      (request) =>
        request.userId === binding.userId &&
        request.account === binding.username &&
        request.state === 'queued'
    );
    if (observation)
      return { pending: true, id: observation.id, account: binding.username };
  }
  if (
    !setting?.enabled ||
    setting.account !== binding.username ||
    writes.intents.some(
      (i) =>
        i.userId === binding.userId &&
        ['dispatched', 'unknown', 'conflict'].includes(i.state)
    )
  )
    return { pending: false };
  const job = readWriteState().intents.find(
    (i) =>
      i.userId === binding.userId &&
      i.account === binding.username &&
      i.kind !== 'watchlist' &&
      i.state === 'queued'
  );
  return job
    ? { pending: true, id: job.id, account: binding.username }
    : { pending: false };
}
export function scheduleBrowserScans() {
  updateBrowserState((state) => queueBrowserScans(state, Date.now()));
}
export function scheduleBrowserExports() {
  updateBrowserState((state) => queueBrowserExports(state, Date.now()));
}
export function refreshBrowserWatchlist(instance: string) {
  updateBrowserState((state) => {
    const binding = state.bindings.find((b) => b.instance === instance);
    if (!binding || ['queued', 'running'].includes(binding.job?.state || ''))
      return;
    delete binding.lastSuccess;
    queueBrowserScans(state, Date.now());
  });
}
let healthRunning = false;
export async function monitorLetterboxdBrowsers() {
  if (healthRunning) return;
  healthRunning = true;
  try {
    updateBrowserState((state) => checkBrowserHealth(state, Date.now()));
    const incidents = readBrowserState().bindings.filter(
      (row) => row.enabled && row.issue && row.notifiedIssue !== row.issue
    );
    const { exportConflicts } = await import('./letterboxdExportPolicy');
    const conflicts = await exportConflicts();
    updateObservations((state) => maintainObservationHealth(state, Date.now()));
    const readIssues = observationHealthIssues(
      readObservations().requests,
      Date.now()
    );
    const writeIncidents = updateBrowserState((state) => {
      const writes = readWriteState();
      return state.bindings.flatMap((binding) => {
        const alert = assessWriteHealth(
          binding,
          [
            ...writes.intents,
            ...conflicts,
            ...readIssues,
            ...(writes.preparationFailures || []),
          ],
          Date.now()
        );
        return alert ? [{ binding, alert }] : [];
      });
    });
    if (!incidents.length && !writeIncidents.length) return;
    const settings = getSettings().notifications.agents.email;
    if (!settings.enabled) throw Error('Email notifications are disabled');
    const owner = await getRepository(User).findOne({ where: { id: 1 } });
    if (!owner?.email) throw Error('Administrator email unavailable');
    const reasons = {
      offline: 'The browser is not responding.',
      cloudflare: 'A browser security check needs your attention.',
      identity:
        'The signed-in account could not be verified. Check for a logout or the wrong profile.',
      verification:
        'The browser could not verify the result. The job is paused.',
      timeout: 'The job did not finish in time and is paused.',
    };
    for (const row of incidents) {
      const issue = row.issue!;
      const email = new PreparedEmail(settings);
      await email.send({
        message: {
          to: owner.email,
          subject: `Multimeldia: Letterboxd needs attention (${row.username})`,
          text: row.job?.reconciliationError
            ? `${row.username}: Export reconciliation paused.\n\n${row.job.reconciliationError}\n\nSee the Letterboxd server logs for the failed attempt. The export is retained; no Letterboxd write was retried. This is a server-side failure, not necessarily a browser or sign-in problem.`
            : `${row.username}: ${reasons[issue]}\n\nOpen this account's Edge profile on prpl-pc. No automatic retry will change your Letterboxd data. The last verified watchlist is retained.\n\nMultimeldia: Letterboxd requiere atención. Revisa el perfil de Edge de esta cuenta; se conserva la última lista verificada.`,
        },
      });
      updateBrowserState((state) => {
        const current = state.bindings.find((b) => b.instance === row.instance);
        if (current?.issue === issue) current.notifiedIssue = issue;
      });
    }
    for (const { binding, alert } of writeIncidents) {
      // Only validated account identifiers and aggregate statuses reach email.
      const account = /^[a-z0-9_-]{1,100}$/i.test(binding.username)
        ? binding.username
        : `user ${binding.userId}`;
      const failures = (readWriteState().preparationFailures || []).filter(
        (i) =>
          i.userId === binding.userId &&
          i.account === binding.username &&
          Number.isFinite(i.firstFailedAt) &&
          Date.now() - i.firstFailedAt! >= 15 * 60 * 1000 &&
          (i.attempts ?? 0) >= 3
      );
      const preparationDetails = failures.length
        ? 'A background activity check has failed repeatedly for at least 15 minutes. This does not mean a Letterboxd write failed. Automatic checks continue; the administrator should check the catalogue job logs. No review needs to be re-submitted.\n\n'
        : '';
      const readDetails = readIssues.some(
        (i) => i.userId === binding.userId && i.account === binding.username
      )
        ? 'A browser read needed for publishing failed or has waited more than 15 minutes. Check this account’s Edge profile and catalogue job status; do not re-submit the review.\n\n'
        : '';
      if (failures.length)
        logger.error('Letterboxd publication preparation needs attention', {
          label: 'Letterboxd',
          userId: binding.userId,
          account,
          phases: failures.map((i) =>
            /^[a-z-]{1,60}$/.test(i.phase) ? i.phase : 'unknown'
          ),
        });
      const details =
        preparationDetails +
        readDetails +
        readWriteState()
          .intents.filter(
            (i) =>
              i.userId === binding.userId &&
              i.account === binding.username &&
              (['unknown', 'conflict'].includes(i.state) ||
                (['queued', 'dispatched'].includes(i.state) &&
                  Date.now() - i.created > 15 * 60 * 1000))
          )
          .slice(0, 10)
          .map((i) => {
            const film = /^[a-z0-9-]{1,200}$/.test(i.film || '')
              ? i.film
              : null;
            const fields = (i.recovery?.differingFields || [])
              .filter((f) => ['rating', 'text', 'spoiler', 'entry'].includes(f))
              .join(', ');
            const reason =
              i.recovery?.status === 'mismatch'
                ? `Automatic read-back found different fields: ${fields}. No second write was attempted.`
                : i.recovery?.status === 'unavailable'
                  ? 'Automatic read-back could not establish the result. Check this account for a login/security prompt.'
                  : 'The result still needs read-only verification; do not recreate the entry.';
            return `${film ? film.replace(/-/g, ' ') : 'Unidentified film'}: ${reason}${film ? '\nhttps://letterboxd.com/' + account + '/film/' + film + '/' : ''}`;
          })
          .join('\n\n');
      const uncertainWrite = readWriteState().intents.some(
        (i) =>
          i.userId === binding.userId &&
          i.account === binding.username &&
          ['unknown', 'dispatched'].includes(i.state)
      );
      const introduction = uncertainWrite
        ? 'A submitted write needs verification. It remains held to prevent duplicate entries or overwriting an edit.'
        : 'A background sync check or conflict needs attention. This is not evidence of an uncertain Letterboxd write.';
      await new PreparedEmail(settings).send({
        message: {
          to: owner.email,
          subject: `Multimeldia: Letterboxd ${uncertainWrite ? 'publishing' : 'background sync'} needs attention (${account})`,
          text: `${account}: ${introduction}\n\n${details}\n\nNo need to re-submit the review. If a login/security prompt is open, resolve it in this account's Edge profile on prpl-pc. Otherwise the administrator should inspect the catalogue job logs.\n\nMultimeldia: ${uncertainWrite ? 'Un envío necesita verificación; no se repetirá automáticamente para evitar duplicados.' : 'Una comprobación de sincronización requiere atención; esto no implica que haya fallado un envío a Letterboxd.'} No vuelvas a enviar la reseña.`,
        },
      });
      updateBrowserState((state) => {
        const current = state.bindings.find(
          (b) =>
            b.instance === binding.instance && b.username === binding.username
        );
        if (!current) return;
        current.lastWriteAlert = Date.now();
        // A newer incident is not acknowledged by an older email.
        const active = assessWriteHealth(
          {
            ...current,
            lastWriteAlert: undefined,
            notifiedWriteIssue: undefined,
          },
          [
            ...readWriteState().intents,
            ...conflicts,
            ...readIssues,
            ...(readWriteState().preparationFailures || []),
          ],
          Date.now()
        );
        if (active?.fingerprint === alert.fingerprint)
          current.notifiedWriteIssue = alert.fingerprint;
      });
    }
  } finally {
    healthRunning = false;
  }
}
