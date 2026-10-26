import { createHash } from 'crypto';
import type { recommend } from './discoveryRecommendations';

type Ranking = ReturnType<typeof recommend>;
const entries = new Map<string, { until: number; value: Ranking }>();
// Cache only the pure ranking. Every request still rebuilds visibility, watched
// state and availability. A changed input cannot reuse a previous projection.
export function cachedDiscoveryRanking(
  input: unknown,
  compute: () => Ranking,
  now = Date.now()
): Ranking {
  const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const hit = entries.get(key);
  if (hit && hit.until > now) return structuredClone(hit.value);
  const value = compute();
  for (const [id, entry] of entries) if (entry.until <= now) entries.delete(id);
  if (entries.size >= 32) entries.delete(entries.keys().next().value!);
  entries.set(key, { until: now + 60000, value: structuredClone(value) });
  return value;
}
