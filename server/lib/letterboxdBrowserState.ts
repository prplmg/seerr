import { createHash, randomUUID } from 'crypto';

export type BrowserIssue =
  | 'offline'
  | 'cloudflare'
  | 'identity'
  | 'verification'
  | 'timeout';
export type WatchlistItem = { slug: string; title: string };
export type BrowserBinding = {
  userId: number;
  username: string;
  instance: string;
  enabled: boolean;
  exportCapable?: boolean;
  exportDue?: boolean;
  lastSeen?: number;
  lastSuccess?: number;
  lastCompletedJobId?: string;
  issue?: BrowserIssue;
  notifiedIssue?: BrowserIssue;
  notifiedWriteIssue?: string;
  lastWriteAlert?: number;
  job?: {
    kind?: 'export';
    id: string;
    created: number;
    startedAt?: number;
    reconciliationStartedAt?: number;
    reconciliationError?: string;
    state: 'queued' | 'running' | 'succeeded' | 'blocked';
  };
  snapshot?: { captured: number; items: WatchlistItem[] };
};
export type BrowserState = {
  version: 1;
  tokenHash?: string;
  bindings: BrowserBinding[];
};
export const browserInterval = 12 * 60 * 60 * 1000;

// Persist fingerprints, not review contents. A recovered incident can alert again,
// but flapping or newly blocked jobs cannot send more than once per account/12h.
export function assessWriteHealth(
  binding: BrowserBinding,
  intents: readonly {
    id: string;
    userId: number;
    account: string;
    state: string;
    created?: number;
    recovery?: { status: string; requestedAt: number };
    firstFailedAt?: number;
    attempts?: number;
  }[],
  now: number
) {
  const blocked = intents.filter(
    (i) =>
      i.userId === binding.userId &&
      i.account === binding.username &&
      (!i.id.startsWith('preparation:') ||
        (Number.isFinite(i.firstFailedAt) && now-i.firstFailedAt! >= 15*60*1000 && (i.attempts ?? 0) >= 3)) &&
      (['conflict', 'unknown'].includes(i.state) ||
        (['queued', 'dispatched'].includes(i.state) &&
          Number.isFinite(i.created) &&
          now - i.created! > 15 * 60 * 1000)) &&
      !(
        i.recovery?.status === 'checking' &&
        now - i.recovery.requestedAt < 10 * 60 * 1000
      )
  );
  if (!blocked.length) {
    delete binding.notifiedWriteIssue;
    return;
  }
  if (!binding.enabled) return;
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        blocked
          .map((i) => [i.id, i.state])
          .sort((a, b) => a.join(':').localeCompare(b.join(':')))
      )
    )
    .digest('hex');
  if (
    binding.notifiedWriteIssue === fingerprint ||
    (binding.lastWriteAlert !== undefined &&
      now - binding.lastWriteAlert < browserInterval)
  )
    return;
  return {
    fingerprint,
    conflict: blocked.filter((i) => i.state === 'conflict').length,
    unknown: blocked.filter((i) => i.state === 'unknown').length,
  };
}

/** Only the newest read for each scope can be an outstanding incident. */
export function observationHealthIssues(
  requests: readonly {
    id: string;
    userId: number;
    account: string;
    film: string;
    entryId?: string;
    createNew?: boolean;
    state: string;
    requestedAt: number;
    supersededBy?: string;
  }[],
  now: number
) {
  const newest = new Map<string, (typeof requests)[number]>();
  for (const r of requests) {
    if (r.supersededBy) continue;
    const key = JSON.stringify([
      r.userId,
      r.account,
      r.film,
      r.entryId,
      !!r.createNew,
    ]);
    if (!newest.has(key) || newest.get(key)!.requestedAt <= r.requestedAt)
      newest.set(key, r);
  }
  return [...newest.values()]
    .filter(
      (r) =>
        (['unknown', 'ambiguous'].includes(r.state) && now-r.requestedAt > 15*60*1000) ||
        (['queued', 'claimed'].includes(r.state) &&
          now - r.requestedAt > 15 * 60 * 1000)
    )
    .map((r) => ({
      id: 'observation:' + r.id,
      userId: r.userId,
      account: r.account,
      state: 'unknown',
    }));
}

export function queueBrowserScans(state: BrowserState, now: number) {
  for (const binding of state.bindings) {
    if (
      !binding.enabled ||
      binding.exportDue ||
      (binding.issue && binding.issue !== 'offline') ||
      ['queued', 'running'].includes(binding.job?.state || '')
    )
      continue;
    if (
      binding.lastSuccess !== undefined &&
      now - binding.lastSuccess < browserInterval
    )
      continue;
    binding.job = { id: randomUUID(), created: now, state: 'queued' };
  }
}

export function queueBrowserExports(
  state: BrowserState,
  now: number,
  scheduled = true
) {
  for (const binding of state.bindings) {
    if (scheduled && binding.enabled && binding.exportCapable)
      binding.exportDue = true;
    if (
      !binding.exportDue ||
      !binding.enabled ||
      !binding.exportCapable ||
      (binding.issue && binding.issue !== 'offline') ||
      ['queued', 'running'].includes(binding.job?.state || '')
    )
      continue;
    binding.job = {
      id: randomUUID(),
      created: now,
      state: 'queued',
      kind: 'export',
    };
    delete binding.exportDue;
  }
}

export function checkBrowserHealth(state: BrowserState, now: number) {
  for (const binding of state.bindings) {
    if (!binding.enabled) continue;
    // Legacy in-flight jobs get one bounded grace period on upgrade. Queue age
    // is never execution time, and heartbeats must not extend either deadline.
    if (binding.job?.state === 'running') binding.job.startedAt ??= now;
    // An offline browser may recover on its next heartbeat; uncertain jobs may not.
    if (
      !binding.issue &&
      binding.job &&
      binding.job.state === 'running' &&
      now - (binding.job.reconciliationStartedAt ?? binding.job.startedAt!) > 60 * 60 * 1000
    ) {
      binding.issue = 'timeout';
      binding.job.state = 'blocked';
    } else if (
      !binding.issue &&
      binding.job &&
      ['queued', 'running'].includes(binding.job.state) &&
      now - (binding.lastSeen ?? binding.job?.created ?? now) > 10 * 60 * 1000
    ) {
      binding.issue = 'offline';
    }
  }
}

/** Only call after this exact export has passed validation and committed. */
export function completeReconciledExport(state: BrowserState, instance: string, id: string, account: string, now: number) {
  const binding = state.bindings.find((b) => b.instance === instance && b.enabled);
  if (!binding || binding.username !== account || binding.job?.id !== id || binding.job.kind !== 'export')
    throw Error('Export binding changed');
  if (binding.job.state === 'blocked' && binding.issue === 'timeout') {
    binding.job.state = 'running';
    delete binding.issue;
    delete binding.notifiedIssue;
  }
  return exchangeBrowserJob(state, instance, {id, outcome:'succeeded', identity:account, complete:true, items:binding.snapshot?.items || []}, now);
}

export function validateWatchlistItems(value: unknown): WatchlistItem[] {
  if (!Array.isArray(value) || value.length > 5000)
    throw Error('Invalid snapshot');
  const slugs = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      Object.keys(item).sort().join(',') !== 'slug,title' ||
      typeof item.slug !== 'string' ||
      !/^[a-z0-9-]{1,200}$/.test(item.slug) ||
      typeof item.title !== 'string' ||
      item.title.length > 300 ||
      slugs.has(item.slug)
    )
      throw Error('Invalid snapshot');
    slugs.add(item.slug);
    return { slug: item.slug, title: item.title };
  });
}

export function exchangeBrowserJob(
  state: BrowserState,
  instance: string,
  report: unknown,
  now: number
) {
  const binding = state.bindings.find(
    (row) => row.instance === instance && row.enabled
  );
  if (!binding) throw Error('Unknown browser binding');
  binding.lastSeen = now;
  if (binding.issue === 'offline') {
    delete binding.issue;
    delete binding.notifiedIssue;
  }
  if (report !== undefined) {
    const result = report as {
      id?: string;
      outcome?: string;
      identity?: string;
      complete?: boolean;
      items?: unknown;
      challenge?: boolean;
      error?: string;
    };
    if (
      result?.id &&
      result.id === binding.lastCompletedJobId &&
      result.id !== binding.job?.id
    )
      return exchangeBrowserJob(state, instance, undefined, now);
    if (!result || !binding.job || result.id !== binding.job.id)
      throw Error('Unexpected job report');
    // Lost HTTP acknowledgements may replay the same completed report, never a new job.
    if (binding.job.state === 'succeeded' || binding.job.state === 'blocked')
      return { action: 'idle' as const };
    if (binding.job.state !== 'running') throw Error('Job was not issued');
    if (result.outcome === 'succeeded') {
      if (result.identity !== binding.username || result.complete !== true)
        throw Error('Unverified snapshot');
      const items = validateWatchlistItems(result.items);
      if (binding.job.kind !== 'export') {
        binding.snapshot = { captured: now, items };
        binding.lastSuccess = now;
      }
      binding.job.state = 'succeeded';
      binding.lastCompletedJobId = binding.job.id;
      delete binding.issue;
      delete binding.notifiedIssue;
    } else if (result.outcome === 'blocked' || result.outcome === 'unknown') {
      binding.job.state = 'blocked';
      binding.lastCompletedJobId = binding.job.id;
      binding.issue = result.challenge
        ? 'cloudflare'
        : result.error === 'sign-in-required' ||
            result.error === 'identity-not-verified' ||
            (typeof result.identity === 'string' &&
              result.identity !== binding.username)
          ? 'identity'
          : 'verification';
    } else throw Error('Invalid job outcome');
  }
  queueBrowserExports(state, now, false);
  if (
    binding.issue ||
    !binding.job ||
    !['queued', 'running'].includes(binding.job.state)
  )
    return { action: 'idle' as const };
  binding.job.startedAt ??= now;
  binding.job.state = 'running';
  return {
    id: binding.job.id,
    action:
      binding.job.kind === 'export'
        ? ('export_scan' as const)
        : ('watchlist_scan' as const),
    account: binding.username,
    instance,
  };
}
