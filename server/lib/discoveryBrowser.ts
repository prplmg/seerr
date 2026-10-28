import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  applyPublicList,
  safeListUrl,
  type parseOwnedList,
} from './discoveryListImport';
import { setListSaved, updateListStore } from './discoveryLists';
import { readBrowserState } from './letterboxdBrowser';
type Snapshot = ReturnType<typeof parseOwnedList>;
type Job = {
  id: string;
  url: string;
  users: number[];
  created: number;
  state: 'queued' | 'running' | 'received' | 'succeeded' | 'blocked';
  instance?: string;
  account?: string;
  token?: string;
  snapshot?: Snapshot;
  listId?: string;
  error?: string;
};
const filename = () => path.join(appDataPath(), 'discovery-browser.json');
function read(): Job[] {
  return fs.existsSync(filename())
    ? JSON.parse(fs.readFileSync(filename(), 'utf8'))
    : [];
}
function update(fn: (jobs: Job[]) => void) {
  const jobs = read();
  fn(jobs);
  const file = filename(),
    tmp = file + '.' + randomUUID() + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(tmp, JSON.stringify(jobs), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
export function queueBrowserList(value: string, userId?: number) {
  const url = safeListUrl(value, true);
  let id = '';
  update((jobs) => {
    let job = jobs.find(
      (j) =>
        j.url === url && ['queued', 'running', 'received'].includes(j.state)
    );
    if (!job) {
      if (
        jobs.filter((j) => ['queued', 'running', 'received'].includes(j.state))
          .length >= 40
      )
        throw Error('List import queue full');
      // Retain at most 200 recent terminal records; outstanding imports are never evicted.
      const old = jobs
        .filter((j) => ['succeeded', 'blocked'].includes(j.state))
        .slice(0, -200);
      for (const j of old) jobs.splice(jobs.indexOf(j), 1);
      job = {
        id: randomUUID(),
        url,
        users: [],
        created: Date.now(),
        state: 'queued',
      };
      jobs.push(job);
    }
    if (userId && !job.users.includes(userId)) job.users.push(userId);
    id = job.id;
  });
  return id;
}
function expire() {
  if (!fs.existsSync(filename())) return;
  update((jobs) => {
    for (const job of jobs)
      if (
        ['queued', 'running'].includes(job.state) &&
        Date.now() - job.created > 3600000
      ) {
        job.state = 'blocked';
        job.error =
          'Browser import timed out. Check InPrivate permission and retry.';
      }
  });
}
export function browserListStatus(id: string, userId: number) {
  expire();
  const job = read().find((j) => j.id === id && j.users.includes(userId));
  if (job?.state === 'received') setImmediate(() => void finish(job.id));
  return job
    ? { id: job.id, state: job.state, listId: job.listId, error: job.error }
    : undefined;
}
export function pendingBrowserList(instance: string) {
  expire();
  const bindings = readBrowserState().bindings.filter((b) => b.enabled);
  if (!bindings.some((b) => b.instance === instance)) return { pending: false };
  const job =
    read().find((j) => j.state === 'running' && j.instance === instance) ||
    read().find((j) => j.state === 'queued');
  return job
    ? {
        pending: true,
        id: job.id,
        account: bindings.find((b) => b.instance === instance)!.username,
      }
    : { pending: false };
}
export function validateBrowserList(value: unknown): Snapshot {
  const s = value as Snapshot & {
    anonymous?: boolean;
    complete?: boolean;
    total?: number;
  };
  if (
    !s ||
    s.anonymous !== true ||
    s.complete !== true ||
    !Array.isArray(s.items) ||
    s.items.length > 10000 ||
    s.total !== s.items.length
  )
    throw Error('Incomplete anonymous list');
  safeListUrl(s.url);
  if (
    typeof s.title !== 'string' ||
    s.title.length > 500 ||
    typeof s.description !== 'string' ||
    s.description.length > 20000
  )
    throw Error('Invalid list metadata');
  const urls = new Set<string>();
  for (const r of s.items) {
    if (
      !r ||
      typeof r.url !== 'string' ||
      !/^https:\/\/letterboxd\.com\/film\/(?:[a-z0-9-]+|film:[1-9][0-9]*)\/$/i.test(
        r.url
      ) ||
      urls.has(r.url) ||
      typeof r.title !== 'string' ||
      r.title.length > 500 ||
      typeof r.note !== 'string' ||
      r.note.length > 20000 ||
      typeof r.year !== 'string' ||
      r.year.length > 4
    )
      throw Error('Invalid list item');
    urls.add(r.url);
  }
  if (Buffer.byteLength(JSON.stringify(s)) > 4 * 1024 * 1024)
    throw Error('List too large');
  return {
    url: s.url,
    title: s.title,
    description: s.description,
    items: s.items.map((r) => ({
      url: r.url,
      title: r.title,
      note: r.note,
      year: r.year,
    })),
  };
}
const processing = new Set<string>();
async function finish(id: string) {
  if (processing.has(id)) return;
  processing.add(id);
  try {
    const job = read().find((j) => j.id === id && j.state === 'received');
    if (!job?.snapshot) return;
    const listId = await applyPublicList(job.url, job.snapshot);
    // Re-read subscribers after metadata lookups; another user may have joined.
    const current = read().find((j) => j.id === id)!;
    updateListStore((s) => {
      for (const user of current.users) setListSaved(s, user, listId, true);
    });
    update((jobs) => {
      const j = jobs.find((j) => j.id === id)!;
      j.state = 'succeeded';
      j.listId = listId;
      delete j.snapshot;
    });
  } catch (error) {
    logger.warn('Public list metadata import failed', {
      label: 'Discovery lists',
      jobId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    update((jobs) => {
      const j = jobs.find((j) => j.id === id)!;
      j.state = 'blocked';
      j.error = 'List metadata could not be resolved. Retry the import.';
      delete j.snapshot;
    });
  } finally {
    processing.delete(id);
  }
}
export function exchangeBrowserLists(
  instance: string,
  report?: {
    id: string;
    token: string;
    outcome: string;
    snapshot?: unknown;
    error?: string;
  },
  inPrivateAllowed = false
) {
  const binding = readBrowserState().bindings.find(
    (b) => b.instance === instance && b.enabled
  );
  if (!binding) throw Error('Unknown list worker');
  const now = Date.now();
  if (report)
    update((jobs) => {
      if (
        typeof report.id === 'string' &&
        /^[a-f0-9-]{36}$/.test(report.id) &&
        !jobs.some((j) => j.id === report.id)
      )
        throw Object.assign(new Error('List job no longer retained'), {
          code: 'list-job-retired',
        });
      const job = jobs.find(
        (j) =>
          j.id === report.id &&
          j.instance === instance &&
          j.token === report.token &&
          j.account === binding.username
      );
      if (!job) throw Error('Wrong list delivery');
      if (['received', 'succeeded', 'blocked'].includes(job.state)) return;
      if (report.outcome === 'succeeded') {
        const snapshot = validateBrowserList(report.snapshot);
        if (
          new URL(job.url).hostname === 'letterboxd.com' &&
          snapshot.url !== job.url
        )
          throw Error('List identity changed');
        job.snapshot = snapshot;
        job.state = 'received';
      } else if (['blocked', 'unknown'].includes(report.outcome)) {
        job.state = 'blocked';
        job.error =
          report.error === 'incognito-access-required'
            ? 'Allow the Letterboxd extension in InPrivate to import public lists.'
            : 'Browser could not verify the public list. Check for a challenge or unavailable list, then retry.';
      } else throw Error('Invalid list outcome');
    });
  for (const job of read().filter((j) => j.state === 'received'))
    setImmediate(() => void finish(job.id));
  let response: Record<string, unknown> = { action: 'idle' };
  // A result may be acknowledged after permission was revoked; never dispatch
  // another job without a fresh, explicit permission-bearing heartbeat.
  if (!inPrivateAllowed) return response;
  update((jobs) => {
    for (const j of jobs)
      if (
        ['queued', 'running'].includes(j.state) &&
        now - j.created > 3600000
      ) {
        j.state = 'blocked';
        j.error =
          'List browser did not finish in time. Retry after checking the extension.';
      }
    const outstanding = jobs.find(
      (j) => j.instance === instance && j.state === 'running'
    );
    // All profiles share one machine/IP. Keep at most two list scans in flight.
    const job =
      outstanding ||
      (jobs.filter((j) => j.state === 'running').length < 2
        ? jobs.find((j) => j.state === 'queued')
        : undefined);
    if (!job) return;
    if (!outstanding) {
      job.state = 'running';
      job.instance = instance;
      job.account = binding.username;
      job.token = randomUUID();
    }
    response = {
      action: 'list_scan',
      id: job.id,
      instance,
      account: job.account,
      url: job.url,
      token: job.token,
    };
  });
  return response;
}
