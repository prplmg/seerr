import { SettingsContext } from '@app/context/SettingsContext';
import { Permission, useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useContext, useEffect } from 'react';

import { readAnalyticsMode } from './mode';

type SDK = {
  __loaded?: boolean;
  set_config: (config: Record<string, unknown>) => void;
  init: (token: string, config: Record<string, unknown>) => void;
  capture: (event: string, properties: Record<string, unknown>) => void;
  identify: (id: string) => void;
  reset: () => void;
  stopSessionRecording: () => void;
  startSessionRecording: () => void;
  opt_out_capturing: () => void;
  opt_in_capturing: () => void;
};
const safePage = (url: string) => {
  const path = url.split(/[?#]/)[0];
  if (['/', '/for-you', '/find-to-watch', '/ai-search'].includes(path))
    return path;
  if (/^\/(movie|tv)\/\d+$/.test(path)) return path.replace(/\d+$/, ':id');
  return null;
};

// Deliberately independent of PostHog: the control group records these too.
export default function AnalyticsTrial() {
  const { user, hasPermission } = useUser();
  const isAdmin = hasPermission(Permission.ADMIN);
  const router = useRouter();
  const userId = user?.id;
  const { currentSettings } = useContext(SettingsContext);
  const { enabled, token, host, experiment } =
    currentSettings.analyticsTrial || {};
  useEffect(() => {
    if (!userId || !enabled || !token || !host) return;
    let active = true;
    let sdk: SDK | undefined;
    let variant = 'off';
    let loadSdk: (() => void) | undefined;
    let loading = false;
    const initialPage = safePage(location.pathname) || 'excluded';
    let session = '';
    let timer: ReturnType<typeof setInterval> | undefined;
    let reports = 0;
    const observers: PerformanceObserver[] = [];
    const values: Record<string, number> = {
      mounted: performance.now(),
      longTasks: 0,
      longTaskMs: 0,
    };
    const observe = (type: string, callback: (e: PerformanceEntry) => void) => {
      try {
        const observer = new PerformanceObserver((list) =>
          list.getEntries().forEach(callback)
        );
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {
        /* Unsupported measurements remain absent. */
      }
    };
    observe('paint', (e) => {
      if (e.name === 'first-contentful-paint') values.fcp = e.startTime;
    });
    observe('largest-contentful-paint', (e) => {
      values.lcp = e.startTime;
    });
    observe('longtask', (e) => {
      values.longTasks++;
      values.longTaskMs += e.duration;
    });
    observe('event', (e) => {
      values.maxInteractionMs = Math.max(
        values.maxInteractionMs || 0,
        e.duration
      );
    });
    const report = () => {
      if (!active || !session || reports++ >= 10) return;
      void axios
        .post('/api/v1/analytics-trial/metrics', {
          session,
          variant,
          page: initialPage,
          metrics: { ...values, elapsed: performance.now(), width: innerWidth },
        })
        .catch(() => undefined);
    };
    const leave = () => {
      if (document.visibilityState === 'hidden') report();
    };
    const stop = () => {
      sdk?.stopSessionRecording();
      sdk?.opt_out_capturing();
    };
    const page = (url: string) => {
      const name = safePage(url);
      if (!name) {
        stop();
        return;
      }
      if (!sdk) {
        loadSdk?.();
        return;
      }
      sdk.opt_in_capturing();
      sdk.capture('$pageview', { page: name, trial_variant: variant });
      if (variant === 'replay' && !url.includes('?'))
        sdk.startSessionRecording();
    };
    const action = (event: Event) => {
      const el =
        event.target instanceof Element
          ? event.target.closest('[data-analytics-action]')
          : null;
      const name = el?.getAttribute('data-analytics-action');
      if (safePage(location.pathname) && name && /^[a-z_]{1,40}$/.test(name))
        sdk?.capture('catalogue_action', {
          action: name,
          trial_variant: variant,
        });
    };
    router.events.on('routeChangeStart', stop);
    router.events.on('routeChangeComplete', page);
    document.addEventListener('visibilitychange', leave);
    document.addEventListener('click', action, true);
    void Promise.resolve({ enabled, token, host, experiment })
      .then((data) => {
        if (!active || !data.enabled) return;
        session = crypto.randomUUID();
        variant = readAnalyticsMode(userId, isAdmin);
        timer = setInterval(report, 30_000);
        values.assigned = performance.now();
        if (variant === 'off') return;
        loadSdk = () => {
          if (!active || loading || !safePage(location.pathname)) return;
          loading = true;
          values.sdkRequested = performance.now();
          const script = document.createElement('script');
          script.async = true;
          script.src = `${data.host!.replace('.i.posthog.com', '-assets.i.posthog.com')}/static/1.447.7/array.js`;
          script.onerror = () => {
            values.sdkFailed = 1;
            report();
          };
          script.onload = () => {
            if (!active) return;
            sdk = (window as Window & { posthog?: SDK }).posthog;
            if (!sdk) {
              values.sdkFailed = 1;
              return;
            }
            const options = {
              api_host: data.host,
              defaults: '2026-05-30',
              autocapture: false,
              capture_pageview: false,
              capture_pageleave: false,
              capture_heatmaps: false,
              capture_performance: false,
              capture_exceptions: false,
              disable_surveys: true,
              disable_session_recording: true,
              person_profiles: 'identified_only',
              session_recording: {
                maskAllInputs: true,
                maskTextSelector: '*',
                blockSelector:
                  'input,textarea,[contenteditable],.ph-no-capture',
              },
              before_send: (e: { properties: Record<string, unknown> }) => {
                if (!active || !safePage(location.pathname)) return null;
                e.properties.$current_url =
                  location.origin + (safePage(location.pathname) || '/');
                delete e.properties.$referrer;
                delete e.properties.$initial_referrer;
                return e;
              },
              loaded: () => {
                if (!active) {
                  stop();
                  return;
                }
                values.sdkReady = performance.now();
                sdk?.opt_in_capturing();
                sdk?.identify(String(userId));
                page(location.pathname + location.search);
              },
            };
            if (sdk.__loaded) {
              sdk.set_config(options);
              options.loaded();
            } else {
              sdk.init(data.token!, options);
            }
          };
          document.head.appendChild(script);
        };
        loadSdk();
      })
      .catch(() => undefined);
    return () => {
      report();
      active = false;
      stop();
      sdk?.reset();
      observers.forEach((o) => o.disconnect());
      if (timer) clearInterval(timer);
      router.events.off('routeChangeStart', stop);
      router.events.off('routeChangeComplete', page);
      document.removeEventListener('visibilitychange', leave);
      document.removeEventListener('click', action, true);
    };
  }, [userId, isAdmin, router.events, enabled, host, token, experiment]);
  return null;
}
