# Mobile push opt-in prompt — local preview, not deployed

Signed-in mobile users get a small dismissible card1.5seconds after mount when push registration is configured. No page-load dependency, polling, permission request or subscription write during eligibility. Supported browsers check their actual SW subscription and exact user/endpoint registration; another device/user-agent match does not suppress the prompt. Already enabled devices and denied permissions stay quiet. No worker readiness within8seconds or verification errors skip this visit (endpoint404 alone is absence; network/server errors are not). Not now snoozes7days in per-user/browser localStorage, with document-memory fallback.

Enable invokes permission from the button gesture then reuses existing subscription helper; successful registration hides prompt and retains normal notification preferences. Error remains visible with retry/profile guidance. No automatic opt-in/toggle changes. iPhone/iPad browser tabs instead show Show me how with Safari Share → Add to Home Screen → Open as Web App if offered → open Home Screen icon → Enable/Allow. Existing installations cannot be detected from another browser context; guidance explains opening the icon if already installed.

Related safety fixes: registration no longer deletes different endpoints merely for an identical user-agent (two phones may match). Expired subscriptions retain existing delivery404/410 cleanup. Endpoint lookup returns404 only when actually missing and500 on DB errors, avoiding a false opt-in prompt during outages. Existing auth/own-profile checks retained.

Checks: client/server TypeScript and focused ESLint; actual-component+globalCSS browser tests with mocked permission/subscription APIs cover default mobile prompt, no automatic permission, click opt-in, installation instructions, persisted snooze, registered-device suppression, denied/outage/desktop suppression, missing endpoint and320px overflow. Backend tests execute actual route handlers with fixture repositories: two identical-user-agent devices coexist, duplicate and rotated-key registration remain idempotent, per-user endpoint isolation,404vs500. No real push permission/delivery tested on an iPhone; that remains post-deployment acceptance. No production writes/notification sends, deployment or push.

Previews/evidence outputs/mobile-push-prompt-20261108/banner-mobile.png, install-banner-mobile.png, instructions-mobile.png and backend-tests.log. Scoped Git commit; unrelated generated next-env.d.ts excluded.

Preview revision: Not now aligns to the right using an auto margin, including wrapped layouts. Simplified Safari steps to three-dots icon → Share icon, Add to Home Screen/Open as Web App/Add, then launch Home Screen app and tap Enable notifications. Android uses the supported-browser Enable banner directly, without install guidance. Still undeployed.

Banner refinement: Enable notifications grows to occupy remaining action-row width alongside right-aligned Not now. Renamed Hide steps to Collapse instructions: collapses only the steps, whereas Not now dismisses/snoozes the entire banner7days. Local only.

Final instruction actions: once steps are expanded, only right-aligned Not now remains. Seven-day dismissal notice centered on both banners. New screenshots use final-v4 filenames, preserving earlier previews. Still undeployed.
