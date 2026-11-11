import logger from '@server/logger';
import {
  queueWeeklyBrowserList,
  weeklyBrowserResult,
} from './discoveryBrowser';
import { readListStore, updateListStore } from './discoveryLists';
import { popularListUrls } from './discoveryPopularLists';
import {
  WEEK,
  WEEKLY_LIST_MAX,
  weeklyClock,
  weeklyDiscoveryPages,
  weeklyWindow,
} from './weeklyListsPolicy';
import {
  permitWeeklyLists,
  readWeeklyLists,
  updateWeeklyLists,
  weeklyManualUntil,
} from './weeklyListsState';

export async function runWeeklyLists(
  maintenanceBusy: () => Promise<boolean>,
  now = Date.now()
) {
  permitWeeklyLists(0);
  const manualUntil = weeklyManualUntil(now);
  if (!weeklyWindow(now) && !manualUntil) return;
  const clock = weeklyClock(now),
    state = readWeeklyLists();
  const due =
    clock.day === 'Tue' &&
    (!state.startedAt ||
      (state.completedAt && now - state.startedAt >= 6 * 86400000));
  if (!due && (!state.startedAt || state.completedAt)) return;
  if (await maintenanceBusy()) {
    updateWeeklyLists((s) => {
      s.deferred = 'Heavy maintenance active or health unavailable';
    });
    return;
  }
  updateWeeklyLists((s) => {
    delete s.deferred;
  });
  const end = manualUntil || now + (520 - clock.minute) * 60000 - (now % 60000);
  permitWeeklyLists(Math.min(now + 90000, end));
  if (due)
    updateWeeklyLists((s) => {
      s.startedAt = now;
      delete s.completedAt;
      delete s.discoveredAt;
      s.pages = {};
      s.queue = [];
      delete s.deferred;
    });
  const current = readWeeklyLists();
  if (!current.discoveredAt) {
    for (const url of weeklyDiscoveryPages) {
      const p = current.pages[url];
      if (p?.rows) continue;
      if (p && !p.job && p.attempts >= 3) {
        updateWeeklyLists((s) => {
          s.completedAt = now;
          s.deferred =
            'Discovery failed three mornings; previous pool retained';
        });
        permitWeeklyLists(0);
        logger.warn('Weekly discovery incomplete; previous pool retained', {
          label: 'Discovery lists',
          page: url,
        });
        return;
      }
      if (p?.job) {
        const result = weeklyBrowserResult(p.job);
        if (result?.state === 'succeeded' && result.rows) {
          updateWeeklyLists((s) => {
            s.pages[url].rows = result.rows;
          });
          continue;
        }
        if (result && result.state !== 'blocked') return;
        updateWeeklyLists((s) => {
          delete s.pages[url].job;
          s.pages[url].error = result?.error || 'Missing browser job';
        });
        return;
      }
      // At most one attempt per page each morning. Failed probes never retire lists.
      if (p?.attempts && current.lastDay === clock.date) return;
      const id = queueWeeklyBrowserList(url, true);
      updateWeeklyLists((s) => {
        s.pages[url] = { job: id, attempts: (p?.attempts || 0) + 1 };
        s.lastDay = clock.date;
      });
      return;
    }
    const evidence = readWeeklyLists();
    if (weeklyDiscoveryPages.some((url) => !evidence.pages[url]?.rows)) return;
    const all = new Map(
      weeklyDiscoveryPages
        .flatMap((url) => evidence.pages[url].rows!)
        .map((c) => [c.url, c])
    );
    updateWeeklyLists((s) => {
      for (const url of popularListUrls) if (!s.seen[url]) s.seen[url] = now;
      for (const c of all.values())
        if (c.total > 0 && c.total <= WEEKLY_LIST_MAX) s.seen[c.url] = now;
      s.queue = [...all.values()]
        .filter((c) => c.total > 0 && c.total <= WEEKLY_LIST_MAX)
        .sort((a, b) => a.total - b.total || a.url.localeCompare(b.url))
        .map((c) => ({ url: c.url, attempts: 0 }));
      s.discoveredAt = now;
    });
    const seen = readWeeklyLists().seen;
    const retired: string[] = [];
    updateListStore((s) => {
      const saved = new Set(Object.values(s.saved).flat());
      const liked = new Set(Object.values(s.liked).flat());
      s.lists = s.lists.filter((l) => {
        if (l.url && popularListUrls.includes(l.url) && !l.ownerId)
          l.automatic = true;
        if (
          !l.automatic ||
          !l.url ||
          l.ownerId ||
          saved.has(l.id) ||
          liked.has(l.url) ||
          liked.has(l.id)
        )
          return true;
        if (seen[l.url] && now - seen[l.url] >= 2 * WEEK) {
          retired.push(l.url);
          return false;
        }
        return true;
      });
    });
    updateWeeklyLists((s) => {
      s.retired = retired;
      const retained = new Set(readListStore().lists.map((l) => l.url));
      for (const [url, seenAt] of Object.entries(s.seen))
        if (!retained.has(url) && now - seenAt > 2 * WEEK) delete s.seen[url];
    });
    logger.info('Weekly list discovery reconciled', {
      label: 'Discovery lists',
      candidates: all.size,
      eligible: readWeeklyLists().queue.length,
      retired: retired.length,
    });
  }
  for (const item of readWeeklyLists().queue) {
    if (item.done) continue;
    if (item.job) {
      const result = weeklyBrowserResult(item.job);
      if (result?.state === 'succeeded') {
        updateListStore((s) => {
          const list = s.lists.find((l) => l.id === result.listId);
          if (list) list.automatic = true;
        });
        updateWeeklyLists((s) => {
          s.queue.find((q) => q.url === item.url)!.done = true;
        });
        continue;
      }
      if (result && result.state !== 'blocked') return;
      updateWeeklyLists((s) => {
        const q = s.queue.find((q) => q.url === item.url)!;
        delete q.job;
        q.error = result?.error || 'Missing job';
      });
      return;
    }
    if (item.attempts >= 3) continue; // Keep the old snapshot and surface the failure.
    const id = queueWeeklyBrowserList(item.url);
    updateWeeklyLists((s) => {
      const q = s.queue.find((q) => q.url === item.url)!;
      q.job = id;
      q.attempts++;
    });
    return;
  }
  updateWeeklyLists((s) => {
    s.completedAt = now;
  });
  permitWeeklyLists(0);
  const result = readWeeklyLists();
  logger.info('Weekly list refresh completed', {
    label: 'Discovery lists',
    succeeded: result.queue.filter((q) => q.done).length,
    failed: result.queue.filter((q) => !q.done).length,
  });
}
