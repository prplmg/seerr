import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import { subscribeToPushNotifications } from '@app/utils/pushSubscriptionHelpers';
import {
  ArrowUpOnSquareIcon,
  BellIcon,
  EllipsisHorizontalCircleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { PUSH_SNOOZE_MS, pushPromptMode, type PushPromptMode } from './policy';

const snoozed = new Map<number, number>();

export default function MobilePushPrompt() {
  const { user } = useUser();
  const { currentSettings } = useSettings();
  const [mode, setMode] = useState<PushPromptMode>(null);
  const [instructions, setInstructions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const userId = user?.id;
  const { enablePushRegistration, vapidPublic } = currentSettings;

  useEffect(() => {
    setMode(null);
    setInstructions(false);
    setError('');
    if (!userId || !enablePushRegistration || !vapidPublic) return;
    let until = snoozed.get(userId) ?? 0;
    try {
      until = Math.max(
        until,
        Number(localStorage.getItem(`push-prompt:${userId}`)) || 0
      );
    } catch {
      /* Optional storage. */
    }
    if (until > Date.now()) return;
    let cancelled = false;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const next = pushPromptMode({
        userAgent: navigator.userAgent,
        touchPoints: navigator.maxTouchPoints,
        standalone,
        supported:
          window.isSecureContext &&
          'Notification' in window &&
          'PushManager' in window &&
          'serviceWorker' in navigator,
        permission:
          'Notification' in window ? Notification.permission : undefined,
      });
      if (!next) return;
      if (next === 'install') {
        if (!cancelled) setMode(next);
        return;
      }
      try {
        // One deferred check, no polling or change to existing subscriptions.
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((resolve) => {
            readyTimeout = setTimeout(() => resolve(null), 8000);
          }),
        ]);
        if (readyTimeout) clearTimeout(readyTimeout);
        if (!registration || cancelled) return;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          try {
            const { data } = await axios.get<{ endpoint: string }>(
              `/api/v1/user/${userId}/pushSubscription/${encodeURIComponent(subscription.endpoint)}`,
              { timeout: 5000 }
            );
            if (
              data.endpoint === subscription.endpoint &&
              Notification.permission === 'granted'
            )
              return;
          } catch (e) {
            // Network/server failures must not be mistaken for a missing device.
            if (!axios.isAxiosError(e) || e.response?.status !== 404) return;
          }
        }
        if (!cancelled) setMode('enable');
      } catch {
        /* Skip this visit if device verification is unavailable. */
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (readyTimeout) clearTimeout(readyTimeout);
    };
  }, [userId, enablePushRegistration, vapidPublic]);

  const dismiss = () => {
    if (!userId) return;
    const until = Date.now() + PUSH_SNOOZE_MS;
    snoozed.set(userId, until);
    try {
      localStorage.setItem(`push-prompt:${userId}`, String(until));
    } catch {
      /* In-memory snooze still applies. */
    }
    setMode(null);
  };
  const enable = async () => {
    if (!userId || busy) return;
    setBusy(true);
    setError('');
    try {
      // Invoke permission directly from the tap, before any network/SW awaits.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        dismiss();
        return;
      }
      if (!(await subscribeToPushNotifications(userId, currentSettings)))
        throw new Error('Subscription incomplete');
      try {
        localStorage.setItem('pushNotificationsEnabled', 'true');
      } catch {
        /* Subscription is already registered. */
      }
      setMode(null);
    } catch {
      setError(
        'Could not enable notifications. Try again, or open Profile → Notifications → Web Push.'
      );
    } finally {
      setBusy(false);
    }
  };
  if (!mode) return null;
  return (
    <aside
      aria-label="Notifications on this phone"
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 right-4 z-30 mx-auto max-h-[70dvh] max-w-sm overflow-y-auto rounded-2xl border border-purple-400/40 bg-gray-800 p-4 text-gray-100 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500/15 text-purple-300">
          <BellIcon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-100">
            {mode === 'enable'
              ? 'Enable notifications on this phone?'
              : 'Notifications on your iPhone or iPad'}
          </h2>
          <p className="mt-1 text-sm text-gray-300">
            {mode === 'enable'
              ? 'Get release updates, comments and reactions to your reviews.'
              : 'Add Multimeldia to your Home Screen to receive notifications.'}
          </p>
        </div>
      </div>
      {instructions && (
        <div
          id="push-install-steps"
          className="mt-4 border-t border-gray-700 pt-4 text-sm text-gray-200"
        >
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="text-purple-300">1.</span>
              <span>
                In <strong>Safari</strong>, tap{' '}
                <EllipsisHorizontalCircleIcon
                  className="inline h-5 w-5 text-purple-300"
                  aria-label="the three dots"
                />
                , then{' '}
                <ArrowUpOnSquareIcon
                  className="inline h-5 w-5 text-purple-300"
                  aria-hidden="true"
                />{' '}
                <strong>Share</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-300">2.</span>
              <span>
                Look for{' '}
                <PlusIcon
                  className="inline h-4 w-4 text-purple-300"
                  aria-hidden="true"
                />{' '}
                <strong>Add to Home Screen</strong>. If shown, keep{' '}
                <strong>Open as Web App</strong> on, then tap{' '}
                <strong>Add</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-300">3.</span>
              <span>
                Open <strong>Multimeldia from the Home Screen</strong>, then tap{' '}
                <strong>Enable notifications</strong>.
              </span>
            </li>
          </ol>
          <p className="mt-4 text-xs text-gray-400">
            Already added it? Open that icon instead of this browser tab.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      <div
        className={`flex flex-wrap items-center gap-2 ${instructions ? 'mt-1' : 'mt-4'}`}
      >
        {mode === 'enable' ? (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-60"
          >
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        ) : !instructions ? (
          <button
            type="button"
            onClick={() => setInstructions(true)}
            aria-expanded={instructions}
            aria-controls="push-install-steps"
            className="min-h-[44px] rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500"
          >
            Show me how
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="ml-auto min-h-[44px] rounded-full px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-60"
        >
          Not now
        </button>
      </div>
    </aside>
  );
}
