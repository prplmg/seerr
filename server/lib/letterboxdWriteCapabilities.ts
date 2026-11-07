import type { WriteIntent } from './letterboxdWriteQueue';

/** Capability eligibility only; account, opt-in and uncertain-write gates remain
 * the responsibility of claimWrite. Keep health and durable replay in agreement. */
export function supportsWriteIntent(
  intent: Pick<WriteIntent, 'kind' | 'desired'>,
  supported: readonly string[]
) {
  return (
    intent.kind !== 'watchlist' &&
    supported.includes(intent.kind) &&
    (intent.kind !== 'diary' ||
      !('rating' in intent.desired) ||
      supported.includes('diary-content'))
  );
}
