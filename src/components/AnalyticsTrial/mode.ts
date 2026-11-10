export type AnalyticsMode = 'off' | 'events' | 'replay';
export const analyticsOverrideKey = (userId: number) =>
  `analytics-admin-mode:${userId}`;

// Legacy randomized assignments are intentionally never read.
export function readAnalyticsMode(
  userId: number,
  isAdmin: boolean
): AnalyticsMode {
  if (!isAdmin) return 'replay';
  try {
    const value = sessionStorage.getItem(analyticsOverrideKey(userId));
    if (value === 'off' || value === 'events') return value;
  } catch {
    // Storage restrictions must not disable the default configuration.
  }
  return 'replay';
}
