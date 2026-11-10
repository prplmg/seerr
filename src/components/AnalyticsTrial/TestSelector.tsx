import { SettingsContext } from '@app/context/SettingsContext';
import { Permission, useUser } from '@app/hooks/useUser';
import { useContext, useEffect, useState } from 'react';
import type { AnalyticsMode } from './mode';
import { analyticsOverrideKey, readAnalyticsMode } from './mode';

export default function AnalyticsTestSelector() {
  const { user, hasPermission } = useUser();
  const userId = user?.id;
  const isAdmin = hasPermission(Permission.ADMIN);
  const { currentSettings } = useContext(SettingsContext);
  const [mode, setMode] = useState<AnalyticsMode>('replay');
  const [error, setError] = useState('');
  useEffect(() => {
    if (userId) setMode(readAnalyticsMode(userId, isAdmin));
  }, [userId, isAdmin]);
  if (!user || !isAdmin || !currentSettings.analyticsTrial?.enabled)
    return null;
  return (
    <section className="mb-8 rounded-xl border border-gray-700 bg-gray-800 p-4 text-gray-100">
      <label htmlFor="analytics-test-mode" className="mb-2 block font-semibold">
        Analytics test mode
      </label>
      <p className="mb-3 text-sm text-gray-400">
        Admin only. Changes apply to this tab and reload it. Everyone else uses
        events + replay.
      </p>
      <select
        id="analytics-test-mode"
        className="w-full rounded-lg border border-gray-600 bg-gray-900 text-gray-100"
        value={mode}
        onChange={(event) => {
          const next = event.target.value as AnalyticsMode;
          try {
            if (next === 'replay')
              sessionStorage.removeItem(analyticsOverrideKey(user.id));
            else sessionStorage.setItem(analyticsOverrideKey(user.id), next);
            window.location.reload();
          } catch {
            setError(
              'This browser could not change the test mode. Your existing mode is unchanged.'
            );
          }
        }}
      >
        <option value="replay">Events + replay (default)</option>
        <option value="events">Events only</option>
        <option value="off">Off</option>
      </select>
      <p className="mt-3 text-sm text-gray-400">
        Off disables PostHog. Lightweight performance measurements remain on in
        all modes.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
