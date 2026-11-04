import { randomUUID } from 'crypto';
import type { ListFilm } from './discoveryLists';
import type { ListSort } from './listSort';
import { listSortReadiness } from './listSort';

type Job = {
  owner: number;
  viewer: number;
  items: ListFilm[];
  sort: ListSort;
  expires: number;
};
/** Progress is an authorized snapshot, not a new list read. No titles, IDs or
 * ownership details are exposed; final results always recheck list access. */
export function createSortProgressTracker(
  readiness = listSortReadiness,
  now = Date.now,
  limit = 128
) {
  const jobs = new Map<string, Job>();
  return {
    register(items: ListFilm[], sort: ListSort, owner: number, viewer: number) {
      for (const [id, job] of jobs) if (job.expires <= now()) jobs.delete(id);
      if (jobs.size >= limit) jobs.delete(jobs.keys().next().value!);
      const id = randomUUID();
      const snapshot = items.map(({ tmdbId, type }) => ({ tmdbId, type }));
      jobs.set(id, {
        owner,
        viewer,
        items: snapshot,
        sort,
        expires: now() + 30 * 60_000,
      });
      return { id, ...readiness(snapshot, sort) };
    },
    read(id: string, owner: number, viewer: number) {
      const job = jobs.get(id);
      if (!job) return { state: 'expired' as const };
      if (job.owner !== owner || job.viewer !== viewer) return null;
      if (job.expires <= now()) {
        jobs.delete(id);
        return { state: 'expired' as const };
      }
      return readiness(job.items, job.sort);
    },
  };
}
export const sortProgress = createSortProgressTracker();
