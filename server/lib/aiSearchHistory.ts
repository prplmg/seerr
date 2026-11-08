import { appDataPath } from '@server/utils/appDataVolume';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { AiFilters, AiPlan } from './aiSearchPlan';

export const SEARCH_RETENTION = 7 * 24 * 60 * 60 * 1000;
export interface SearchHistoryEntry {
  id: string;
  query: string;
  people: number[];
  searchedAt: number;
  filters?: AiFilters;
  filterOrigin?: 'prompt';
}
interface SearchStore {
  history: SearchHistoryEntry[];
  plans: Record<string, { until: number; plan: AiPlan }>;
}
const queues = new Map<number, Promise<unknown>>();
// One writer per user, atomic replacement; no shared catalogue database writes.
async function store<T>(
  userId: number,
  action: (data: SearchStore) => T,
  write = false
): Promise<T> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw Error('Invalid user');
  const previous = queues.get(userId) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      const directory = path.join(appDataPath(), 'ai-search');
      const filename = path.join(directory, `${userId}.json`);
      let data: SearchStore = { history: [], plans: {} };
      try {
        data = JSON.parse(await fs.readFile(filename, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const now = Date.now();
      const oldSize = data.history.length + Object.keys(data.plans).length;
      data.history = data.history.filter(
        (entry) => entry.searchedAt > now - SEARCH_RETENTION
      );
      for (const [key, value] of Object.entries(data.plans))
        if (value.until <= now) delete data.plans[key];
      const pruned =
        oldSize !== data.history.length + Object.keys(data.plans).length;
      const result = action(data);
      if (write || pruned) {
        await fs.mkdir(directory, { recursive: true });
        const temporary = `${filename}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
          await fs.rename(temporary, filename);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }
      return result;
    });
  queues.set(userId, task);
  try {
    return await task;
  } finally {
    if (queues.get(userId) === task) queues.delete(userId);
  }
}
const promptKey = (query: string) =>
  query.trim().replace(/\s+/g, ' ').toLowerCase();
// Older entries stored edited filters, not their generated originals. Never
// replay those overrides as if they came from the prompt.
export function canonicalSearchHistory(entries: SearchHistoryEntry[]) {
  const unique = new Map<string, SearchHistoryEntry>();
  for (const entry of [...entries].sort(
    (a, b) => b.searchedAt - a.searchedAt
  )) {
    const key = promptKey(entry.query);
    if (unique.has(key)) continue;
    unique.set(key, {
      ...entry,
      filters: entry.filterOrigin === 'prompt' ? entry.filters : undefined,
    });
  }
  return [...unique.values()];
}
export const readSearchHistory = (userId: number) =>
  store(userId, (data) => canonicalSearchHistory(data.history));
export const rememberSearch = (
  userId: number,
  query: string,
  people: number[],
  filters?: AiFilters
) =>
  store(
    userId,
    (data) => {
      const selected = [...new Set(people)]
        .filter((id) => id !== userId)
        .sort((a, b) => a - b);
      const id = createHash('sha256').update(promptKey(query)).digest('hex');
      data.history = [
        {
          id,
          query,
          people: selected,
          filters,
          filterOrigin: 'prompt',
          searchedAt: Date.now(),
        },
        ...canonicalSearchHistory(data.history).filter(
          (entry) => promptKey(entry.query) !== promptKey(query)
        ),
      ];
    },
    true
  );
export const readSearchPlan = (userId: number, key: string) =>
  store(userId, (data) => data.plans[key]?.plan);
export const saveSearchPlan = (userId: number, key: string, plan: AiPlan) =>
  store(
    userId,
    (data) => {
      data.plans[key] = { plan, until: Date.now() + SEARCH_RETENTION };
    },
    true
  );
