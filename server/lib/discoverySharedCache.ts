import fs from 'fs';

let revision = 0;
let writes = 0;
const transactions = new Set<object>();
const clearers = new Set<() => void>();
class DiscoveryChanged extends Error {}
let idle: Promise<void> | undefined;
let resolveIdle: (() => void) | undefined;
function notifyIdle() {
  if (!writes && !transactions.size) {
    resolveIdle?.();
    idle = undefined;
    resolveIdle = undefined;
  }
}

// All contending readers share one boundary notification, not a polling loop.
export async function stableDiscoveryRead<T>(
  read: () => Promise<T>,
  timeoutMs = 2000,
  attempts = 4
): Promise<T> {
  // Cold network reads have their own timeouts. Start the contention budget
  // only when a write is encountered, so the first slow read can rebuild.
  let deadline: number | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (writes || transactions.size) {
        deadline ??= Date.now() + timeoutMs;
        idle ??= new Promise<void>((resolve) => {
          resolveIdle = resolve;
        });
        const remaining = deadline - Date.now();
        if (remaining <= 0)
          throw new DiscoveryChanged('Discovery data busy; retry discovery');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            idle,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new DiscoveryChanged('Discovery data busy; retry discovery')
                  ),
                remaining
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      return await read();
    } catch (error) {
      if (!(error instanceof DiscoveryChanged)) throw error;
      deadline ??= Date.now() + timeoutMs;
      if (Date.now() >= deadline || attempt === attempts - 1) throw error;
    }
  }
  throw new DiscoveryChanged('Discovery data busy; retry discovery');
}

// Process-local only. Every writer must use this process's TypeORM datasource.
export function invalidateDiscoveryCache() {
  revision++;
  for (const clear of clearers) clear();
}
export function discoveryWriteBoundary(start: boolean) {
  writes = Math.max(0, writes + (start ? 1 : -1));
  invalidateDiscoveryCache();
  notifyIdle();
}
export function discoveryTransactionBoundary(runner: object, start: boolean) {
  if (transactions.has(runner) === start) return;
  if (start) transactions.add(runner);
  else transactions.delete(runner);
  invalidateDiscoveryCache();
  notifyIdle();
}
export function discoveryRevision() {
  if (writes || transactions.size)
    throw new DiscoveryChanged('Discovery data changing; retry discovery');
  return revision;
}
export function assertDiscoveryRevision(expected: number) {
  if (discoveryRevision() !== expected)
    throw new DiscoveryChanged('Discovery data changed; retry discovery');
}

// Synchronous validation avoids the delivery delay of fs.watch, including
// atomic rename, deletion and recreation. Never treat permission errors as absent.
export function discoveryFileStamp(files: string[]) {
  return JSON.stringify(
    files.map((file) => {
      try {
        const s = fs.statSync(file, { bigint: true });
        return [
          file,
          String(s.dev),
          String(s.ino),
          String(s.size),
          String(s.mtimeNs),
          String(s.ctimeNs),
        ];
      } catch (error) {
        if (error.code === 'ENOENT') return [file, 'absent'];
        throw error;
      }
    })
  );
}

export function discoveryCache<T>(limit = 32, ttl = 15000) {
  const entries = new Map<string, { until: number; value: T }>();
  const pending = new Map<string, Promise<T>>();
  clearers.add(() => {
    entries.clear();
    pending.clear();
  });
  return async (
    key: string,
    load: () => Promise<T>,
    cacheable: (value: T) => boolean = () => true
  ): Promise<T> => {
    const version = discoveryRevision();
    const hit = entries.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const inflight = pending.get(key);
    if (inflight) return inflight;
    // TTL starts before work, so an outer cache cannot extend evidence age.
    const until = Date.now() + ttl;
    const work = Promise.resolve()
      .then(load)
      .then((value) => {
        assertDiscoveryRevision(version);
        if (cacheable(value) && until > Date.now()) {
          for (const [id, entry] of entries)
            if (entry.until <= Date.now()) entries.delete(id);
          if (entries.size >= limit)
            entries.delete(entries.keys().next().value!);
          entries.set(key, { until, value });
        }
        return value;
      });
    // Bound retained pending entries too; overflow still executes uncached.
    if (pending.size < limit) pending.set(key, work);
    try {
      return await work;
    } finally {
      if (pending.get(key) === work) pending.delete(key);
    }
  };
}
