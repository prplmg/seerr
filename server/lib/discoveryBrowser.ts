import { readTaskDocument, updateTaskDocument } from './letterboxdTaskStore';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  applyPublicList,
  importPublicList,
  safeListUrl,
  type parseOwnedList,
} from './discoveryListImport';
import { setListSaved, updateListStore } from './discoveryLists';
import { readBrowserState } from './letterboxdBrowser';
import {
  validateDiscoverySnapshot,
  weeklyDiscoveryPages,
} from './weeklyListsPolicy';
import { weeklyListsPermitted } from './weeklyListsState';
type Snapshot = ReturnType<typeof parseOwnedList>;
type Job = {
  id: string;
  url: string;
  users: number[];
  weekly?: 'discovery' | 'contents';
  discovery?: ReturnType<typeof validateDiscoverySnapshot>;
  updatedAt?: number;
  created: number;
  state:
    | 'fetching'
    | 'queued'
    | 'running'
    | 'received'
    | 'succeeded'
    | 'blocked';
  instance?: string;
  account?: string;
  token?: string;
  snapshot?: Snapshot;
  listId?: string;
  error?: string;
  attempts?: number;
  retryAt?: number;
};
const filename = () => path.join(appDataPath(), 'discovery-browser.json');
function read(): Job[] {
  return readTaskDocument<Job[]>(filename(), () => []);
}
function update(fn: (jobs: Job[]) => void) {
  return updateTaskDocument<Job[],void>(filename(), () => [], fn);
}
export function queueBrowserList(
  value: string,
  userId?: number,
  direct = false
) {
  const url = safeListUrl(value, true);
  let id = '';
  update((jobs) => {
    let job = jobs.find(
      (j) =>
        j.url === url &&
        (['fetching', 'queued', 'running', 'received'].includes(j.state) ||
          (j.state === 'blocked' && !!j.token && /timed out|did not finish in time/.test(j.error || '')))
    );
    if (!job) {
      if (
        userId &&
        jobs.filter(
          (j) =>
            j.users.includes(userId) &&
            ['fetching', 'queued', 'running', 'received'].includes(j.state)
        ).length >= 3
      )
        throw Error('You already have three list imports pending.');
      if (
        jobs.filter((j) =>
          ['fetching', 'queued', 'running', 'received'].includes(j.state)
        ).length >= 40
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
        state: direct ? 'fetching' : 'queued',
      };
      jobs.push(job);
    }
    if (userId && !job.users.includes(userId)) job.users.push(userId);
    id = job.id;
  });
  if (direct) setImmediate(() => void fetchDirect(id));
  return id;
}
export function queueWeeklyBrowserList(url: string, discovery = false) {
  if (
    discovery ? !weeklyDiscoveryPages.includes(url) : safeListUrl(url) !== url
  )
    throw Error('Invalid weekly list URL');
  let id = '';
  update((jobs) => {
    const old = jobs.find(
      (j) =>
        j.weekly &&
        j.url === url &&
        ['queued', 'running', 'received'].includes(j.state)
    );
    if (old) {
      id = old.id;
      return;
    }
    id = randomUUID();
    jobs.push({
      id,
      url,
      users: [],
      created: Date.now(),
      state: 'queued',
      weekly: discovery ? 'discovery' : 'contents',
    });
  });
  return id;
}
export function weeklyBrowserResult(id: string) {
  update((jobs) => {
    const job = jobs.find((j) => j.id === id && j.weekly);
    if (
      job &&
      ['queued', 'running'].includes(job.state) &&
      Date.now() - (job.updatedAt || job.created) > 86400000
    ) {
      job.state = 'blocked';
      job.error =
        'Automatic list browser unavailable for a day; retry scheduled';
    }
  });
  const j = read().find((j) => j.id === id && j.weekly);
  return (
    j && { state: j.state, rows: j.discovery, error: j.error, listId: j.listId }
  );
}
const directPending = new Set<string>();
async function fetchDirect(id: string) {
  if (directPending.has(id) || directPending.size >= 2) return;
  const job = read().find((j) => j.id === id && j.state === 'fetching');
  if (!job) return;
  directPending.add(id);
  try {
    const listId = await importPublicList(job.url);
    const current = read().filter(j => j.url === job.url && j.state === 'received' && j.created <= job.created);
    updateListStore((s) => {
      for (const user of new Set(current.flatMap(j => j.users))) setListSaved(s, user, listId, true);
    });
    update((jobs) => {
      const j = jobs.find((j) => j.id === id)!;
      j.state = 'succeeded';
      j.listId = listId;
    });
  } catch (error) {
    logger.warn('Direct list import deferred to browser', {
      label: 'Discovery lists',
      jobId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    update((jobs) => {
      const j = jobs.find((j) => j.id === id)!;
      j.state = 'queued';
    });
  } finally {
    directPending.delete(id);
  }
}
function expire() {
  update((jobs) => {
    for (const job of jobs)
      if (
        ['queued', 'running'].includes(job.state) &&
        Date.now() - (job.updatedAt || job.created) > 3600000 &&
        (!job.weekly || job.state === 'running')
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
  if (job?.state === 'fetching') setImmediate(() => void fetchDirect(job.id));
  if (job?.state === 'received' && (job.retryAt || 0) <= Date.now())
    setImmediate(() => void finish(job.id));
  return job
    ? { id: job.id, state: job.state, listId: job.listId, error: job.error }
    : undefined;
}
export function pendingBrowserList(instance: string) {
  expire();
  for (const job of read()) {
    if (job.state === 'fetching') setImmediate(() => void fetchDirect(job.id));
    if (job.state === 'received' && (job.retryAt || 0) <= Date.now())
      setImmediate(() => void finish(job.id));
  }
  const bindings = readBrowserState().bindings.filter((b) => b.enabled);
  if (!bindings.some((b) => b.instance === instance)) return { pending: false };
  const job =
    read().find((j) => j.state === 'running' && j.instance === instance) ||
    read().find(
      (j) => j.state === 'queued' && (!j.weekly || weeklyListsPermitted())
    );
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
const processingUrls = new Set<string>();
async function finish(id: string) {
  if (processing.has(id)) return;
  processing.add(id);
  let processingUrl: string | undefined;
  try {
    const job = read().find((j) => j.id === id && j.state === 'received');
    if (!job?.snapshot || (job.retryAt || 0) > Date.now() || (job.weekly && !weeklyListsPermitted())) return;
    if (processingUrls.has(job.url) || read().some(j => j.url === job.url && j.state === 'received' && j.created > job.created)) return;
    processingUrl = job.url; processingUrls.add(job.url);
    const listId = await applyPublicList(
      job.url,
      job.snapshot,
      job.weekly
        ? () => {
            if (!weeklyListsPermitted())
              throw Object.assign(Error('Weekly window closed'), {
                code: 'weekly-deferred',
              });
          }
        : undefined
    );
    // Re-read subscribers after metadata lookups; another user may have joined.
    const current = read().filter(j => j.url === job.url && j.state === 'received' && j.created <= job.created);
    updateListStore((s) => {
      for (const user of new Set(current.flatMap(j => j.users))) setListSaved(s, user, listId, true);
    });
    update((jobs) => {
      for (const j of jobs.filter(j => current.some(c => c.id === j.id))) {
        j.state = 'succeeded'; j.listId = listId; delete j.snapshot; delete j.error;
      }
    });
  } catch (error) {
    if (error?.code === 'weekly-deferred') return;
    logger.warn('Public list metadata import failed', {
      label: 'Discovery lists',
      jobId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    update((jobs) => {
      const j = jobs.find((j) => j.id === id)!;
      j.attempts = (j.attempts || 0) + 1;
      j.state = j.attempts < 3 ? 'received' : 'blocked';
      j.retryAt = Date.now() + 30_000 * j.attempts;
      j.error =
        j.state === 'blocked'
          ? 'List metadata could not be resolved after three attempts. Please retry.'
          : 'Retrying film metadata lookup…';
      // Retain snapshots between retries, but bound terminal history size.
      if (j.state === 'blocked') delete j.snapshot;
    });
  } finally {
    processing.delete(id);
    if (processingUrl) processingUrls.delete(processingUrl);
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
  inPrivateAllowed = false,
  weeklySupported = false
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
      if (['received', 'succeeded'].includes(job.state)) return;
      // A timed-out scan may already have a durable result in the worker outbox.
      // Validate its original lease and accept it; never require a fresh scan.
      if (job.state === 'blocked' && !/timed out|did not finish in time/.test(job.error || '')) return;
      const newer = jobs.find(j => j.url === job.url && j.created > job.created && ['received','succeeded'].includes(j.state));
      if (report.outcome === 'succeeded') {
        if (job.weekly === 'discovery') {
          job.discovery = validateDiscoverySnapshot(report.snapshot, job.url);
          job.state = 'succeeded';
          return;
        }
        const snapshot = validateBrowserList(report.snapshot);
        if (job.weekly && snapshot.items.length > 560)
          throw Error('Automatic list exceeds 560 items');
        if (
          new URL(job.url).hostname === 'letterboxd.com' &&
          snapshot.url !== job.url
        )
          throw Error('List identity changed');
        if (newer) { job.state='succeeded'; job.listId=newer.listId; job.error=undefined; return; }
        job.snapshot = snapshot;
        job.state = 'received';
        job.error = undefined;
      } else if (['blocked', 'unknown'].includes(report.outcome)) {
        job.state = 'blocked';
        job.error =
          report.error === 'incognito-access-required'
            ? 'Allow the Letterboxd extension in InPrivate to import public lists.'
            : 'Browser could not verify the public list. Check for a challenge or unavailable list, then retry.';
      } else throw Error('Invalid list outcome');
    });
  for (const job of read().filter(
    (j) => j.state === 'received' && (!j.weekly || (j.retryAt || 0) <= now)
  ))
    setImmediate(() => void finish(job.id));
  let response: Record<string, unknown> = { action: 'idle' };
  // A result may be acknowledged after permission was revoked; never dispatch
  // another job without a fresh, explicit permission-bearing heartbeat.
  if (!inPrivateAllowed) return response;
  update((jobs) => {
    for (const j of jobs)
      if (
        ['queued', 'running'].includes(j.state) &&
        now - (j.updatedAt || j.created) > 3600000 &&
        (!j.weekly || j.state === 'running')
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
        ? jobs.find(
            (j) =>
              j.state === 'queued' &&
              (!j.weekly || (weeklySupported && weeklyListsPermitted()))
          )
        : undefined);
    if (!job) return;
    if (!outstanding) {
      job.state = 'running';
      job.updatedAt = now;
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
      ...(job.weekly ? { mode: job.weekly, maxFilms: 560 } : {}),
    };
  });
  return response;
}
