import logger from '@server/logger';
export function recordAiSearchUsage(
  userId: number,
  model: string,
  outcome: 'completed' | 'invalid_response' | 'provider_error' | 'cache',
  usage?: unknown
) {
  const u = usage as
    | {
        input_tokens?: unknown;
        output_tokens?: unknown;
        total_tokens?: unknown;
        input_tokens_details?: {
          cached_tokens?: unknown;
          cache_write_tokens?: unknown;
        };
        output_tokens_details?: { reasoning_tokens?: unknown };
      }
    | undefined;
  const count = (n: unknown) =>
    Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : null;
  const cached = outcome === 'cache';
  logger.info('AI Search usage', {
    label: 'AI Search',
    userId,
    model,
    outcome,
    inputTokens: cached ? 0 : count(u?.input_tokens),
    outputTokens: cached ? 0 : count(u?.output_tokens),
    totalTokens: cached ? 0 : count(u?.total_tokens),
    cachedInputTokens: cached
      ? 0
      : count(u?.input_tokens_details?.cached_tokens),
    cacheWriteTokens: cached
      ? 0
      : count(u?.input_tokens_details?.cache_write_tokens),
    reasoningTokens: cached
      ? 0
      : count(u?.output_tokens_details?.reasoning_tokens),
  });
}
