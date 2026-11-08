# AI Search Back-only restoration

Removed the per-user sessionStorage last-screen restore. Draft/results now live in a small document-memory cache keyed by user and Next's own browser-history entry key (maximum50entries). Fresh link navigation starts blank; Back/router.back restores the matching entry without an API call. Reload resets document memory and starts blank. Persistent7day History and server interpretation cache are unchanged; reopening History is still explicit. Next's installed router preserves its key on popstate/replaceState; no global router interception or extra request.

Placeholder: Stop motion movies from the 2010s, under two hours, available and unwatched, with a Letterboxd score between 3.5 and 4.5…

Checks: TypeScript/ESLint; actual component mocked browser tests for browser Back, app Back, fresh shortcut, distinct draft entry, reload, explicit History and exact placeholder. No additional API call on Back. Helper tests verify Next key reuse, user isolation and distinct entry snapshots. Tests use browser history with Next-style keys; installed Next router key behavior also inspected. Evidence outputs/ai-search-back-20261108. No paid AI calls. No real user/history writes during local tests.
