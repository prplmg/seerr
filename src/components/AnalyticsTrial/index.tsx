import { SettingsContext } from '@app/context/SettingsContext';
import { Permission, useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useContext, useEffect } from 'react';
import { safeSettings } from './events';
import { eventLabel } from './labels';
import { watchlistEvent } from './watchlistEvents';

import {
  capturePath,
  credentialSelector,
  maskCredentialInput,
  redactCredentialUrl,
} from './capture';
import { readAnalyticsMode } from './mode';

type SDK = {
  __loaded?: boolean;
  get_distinct_id?: () => string;
  get_property?: (key: string) => unknown;
  set_config: (config: Record<string, unknown>) => void;
  init: (token: string, config: Record<string, unknown>) => void;
  capture: (event: string, properties: Record<string, unknown>) => void;
  identify: (id: string, properties: Record<string, unknown>) => void;
  reset: () => void;
  stopSessionRecording: () => void;
  startSessionRecording: () => void;
  opt_out_capturing: () => void;
  opt_in_capturing: () => void;
};
const safePage = capturePath;

// Deliberately independent of PostHog: the control group records these too.
export default function AnalyticsTrial() {
  const { user, hasPermission } = useUser();
  const isAdmin = hasPermission(Permission.ADMIN);
  const router = useRouter();
  const userId = user?.id;
  const username =
    user?.displayName ||
    user?.username ||
    user?.plexUsername ||
    user?.jellyfinUsername;
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
          page: /^\/(movie|tv)\/\d+$/.test(initialPage)
            ? initialPage.replace(/\d+$/, ':id')
            : ['/', '/for-you', '/find-to-watch', '/ai-search'].includes(
                  initialPage
                )
              ? initialPage
              : 'excluded',
          metrics: { ...values, elapsed: performance.now(), width: innerWidth },
        })
        .catch(() => undefined);
    };
    const leave = () => {
      if (document.visibilityState === 'hidden') report();
    };
    const stop = () => {
      sdk?.stopSessionRecording();
    };
    let lastPage = '';
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
      // Recording must not depend on a PageTitle mounting or metadata resolving.
      if (variant === 'replay') sdk.startSessionRecording();
      if (document.documentElement.dataset.analyticsPath !== name) return;
      if (lastPage === url) return;
      lastPage = url;
      sdk.capture('$pageview', {
        page: name,
        page_name:
          (
            {
              '/': 'Discovery Page',
              '/ai-search': 'AI Search Page',
              '/for-you': 'For You Page',
              '/lists': 'My Lists Page',
            } as Record<string, string>
          )[name] ||
          document.documentElement.dataset.analyticsTitle ||
          document.title,
        trial_variant: variant,
      });
      if (variant === 'replay') sdk.startSessionRecording();
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
    const completed = (event: Event) => {
      const { name, properties } = (event as CustomEvent).detail;
      if (variant !== 'off') sdk?.capture(name, properties);
    };
    document.defaultView?.addEventListener('catalogue-analytics', completed);
    const interceptor = axios.interceptors.response.use((response) => {
      const { url = '', method, data } = response.config;
      if (
        variant !== 'off' &&
        /^(post|put|patch)$/.test(method || '') &&
        /\/settings\//.test(url) &&
        !/\/settings\/request-watchlist(?:\?|$)/.test(url) &&
        !/\/(test|sync|run|cancel|flush|regenerate)(\?|$)/.test(url)
      ) {
        let values = data;
        try {
          if (typeof values === 'string') values = JSON.parse(values);
        } catch {
          values = undefined;
        }
        sdk?.capture('settings_saved', {
          section: url.split('?')[0],
          values: safeSettings(values),
        });
      }
      if (variant !== 'off') {
        let body: Record<string, unknown> = {};
        try {
          body = typeof data === 'string' ? JSON.parse(data) : data || {};
        } catch {
          /* No payload to report. */
        }
        const watchlist = watchlistEvent(url, method, body);
        if (watchlist) sdk?.capture(watchlist.name, watchlist.properties);
        const interaction = url.match(
          /^\/api\/v1\/review-interactions\/([^/]+)\/(comments|reactions)(?:\/([^/?]+))?$/
        );
        if (interaction && /^(post|put|patch|delete)$/.test(method || '')) {
          const event =
            interaction[2] === 'reactions'
              ? body.active
                ? 'reaction_added'
                : 'reaction_removed'
              : (
                  {
                    post: 'comment_created',
                    patch: 'comment_updated',
                    delete: 'comment_deleted',
                  } as Record<string, string>
                )[method!];
          if (event)
            sdk?.capture(event, {
              review_id: decodeURIComponent(interaction[1]),
              comment_id: body.commentId || interaction[3] || body.id,
              emoji: body.emoji,
            });
        }
        if (
          /^\/api\/v1\/discovery-lists/.test(url) &&
          /^(post|put|patch|delete)$/.test(method || '')
        )
          sdk?.capture('list_action_completed', {
            endpoint: url.split('?')[0],
            method,
            saved: body.saved,
            list_title:
              body.title ||
              response.data?.title ||
              (document.documentElement.dataset.analyticsPath ===
                location.pathname &&
              document.documentElement.dataset.analyticsTitle?.startsWith(
                'List: '
              )
                ? document.documentElement.dataset.analyticsTitle.slice(6)
                : undefined),
          });
      }
      return response;
    });
    const pageReady = () => page(location.pathname + location.search);
    window.addEventListener('catalogue-page-ready', pageReady);
    const routeStart = (url: string) => {
      lastPage = '';
      if (!safePage(url)) stop();
    };
    router.events.on('routeChangeStart', routeStart);
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
              enable_recording_console_log: false,
              disable_surveys: true,
              disable_session_recording: true,
              person_profiles: 'identified_only',
              session_recording: {
                maskAllInputs: true,
                maskInputFn: maskCredentialInput,
                maskTextSelector: '[data-analytics-credential]',
                blockSelector: credentialSelector,
                recordHeaders: false,
                recordBody: false,
                maskCapturedNetworkRequestFn: (request: { name?: string }) => {
                  if (request.name)
                    request.name = redactCredentialUrl(request.name);
                  return request;
                },
              },
              before_send: (e: {
                event: string;
                properties: Record<string, unknown>;
              }) => {
                if (!active || !safePage(location.pathname)) return null;
                e.properties.$current_url = redactCredentialUrl(location.href);
                if (username) e.properties.username = username;
                const media = location.pathname.match(/^\/(movie|tv)\/(\d+)$/);
                if (media && e.properties.media_id === undefined) {
                  e.properties.media_type = media[1];
                  e.properties.media_id = Number(media[2]);
                }
                const pagePath = document.documentElement.dataset.analyticsPath;
                if (
                  media &&
                  pagePath === location.pathname &&
                  Number(media[2]) === e.properties.media_id &&
                  !e.properties.media_title
                ) {
                  const title =
                    document.documentElement.dataset.analyticsTitle || '';
                  const match = title.match(
                    /^(?:Movie|Series): (.*?)(?: \((\d{4})\))?$/
                  );
                  if (match) {
                    e.properties.media_title = match[1];
                    e.properties.release_year = match[2];
                  }
                }
                e.properties.event_label = eventLabel(e.event, e.properties);
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
                if (
                  sdk?.get_distinct_id?.() !== String(userId) ||
                  sdk?.get_property?.('catalogue_username') !== username
                ) {
                  sdk?.identify(String(userId), { name: username, username });
                  (
                    sdk as SDK & {
                      register?: (p: Record<string, unknown>) => void;
                    }
                  )?.register?.({ catalogue_username: username });
                }
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
      window.removeEventListener('catalogue-page-ready', pageReady);
      axios.interceptors.response.eject(interceptor);
      window.removeEventListener('catalogue-analytics', completed);
      report();
      active = false;
      sdk?.opt_out_capturing();
      stop();
      sdk?.reset();
      observers.forEach((o) => o.disconnect());
      if (timer) clearInterval(timer);
      router.events.off('routeChangeStart', routeStart);
      router.events.off('routeChangeComplete', page);
      document.removeEventListener('visibilitychange', leave);
      document.removeEventListener('click', action, true);
    };
  }, [
    userId,
    username,
    isAdmin,
    router.events,
    enabled,
    host,
    token,
    experiment,
  ]);
  return null;
}
