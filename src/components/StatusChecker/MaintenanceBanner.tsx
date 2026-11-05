import axios from 'axios';
import { useEffect, useState } from 'react';

export default function MaintenanceBanner() {
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    const id = axios.interceptors.response.use(undefined, (error) => {
      if (
        error.response?.status === 503 &&
        error.response.headers?.['x-multimeldia-updating'] === '1'
      )
        setUpdating(true);
      return Promise.reject(error);
    });
    return () => axios.interceptors.response.eject(id);
  }, []);
  useEffect(() => {
    if (!updating) return;
    // Recovery only dismisses the notice. Never reload a form or replay a write.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const response = await fetch(
          '/api/v1/status?checkUpdateAvailable=false',
          { cache: 'no-store', signal: controller.signal }
        );
        if (
          response.ok &&
          typeof (await response.json()).version === 'string'
        ) {
          setUpdating(false);
          return;
        }
      } catch {
        /* Retry while the service restarts. */
      }
      if (!controller.signal.aborted) timer = setTimeout(check, 5000);
    }
    timer = setTimeout(check, 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [updating]);
  return updating ? (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[150] mx-auto w-fit rounded-xl border border-purple-400/50 bg-gray-800 px-4 py-2 text-center text-sm text-gray-100 shadow-lg"
    >
      <strong>Multimeldia is updating.</strong> It will only take a few moments.
    </div>
  ) : null;
}
