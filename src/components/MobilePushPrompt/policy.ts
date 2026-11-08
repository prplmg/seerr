export const PUSH_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
export type PushPromptMode = 'enable' | 'install' | null;
export function pushPromptMode({
  userAgent,
  touchPoints,
  standalone,
  supported,
  permission,
}: {
  userAgent: string;
  touchPoints: number;
  standalone: boolean;
  supported: boolean;
  permission?: NotificationPermission;
}): PushPromptMode {
  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && touchPoints > 1);
  if (!ios && !/Android|Mobile/i.test(userAgent)) return null;
  if (permission === 'denied') return null;
  if (ios && !standalone) return 'install';
  return supported ? 'enable' : null;
}
