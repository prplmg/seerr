# Catalogue maintenance screen

Use the existing Caddy VM and release engine. The branded page is self-contained. Only the application switch or rollback takes a lease. Building on Mini does not take one.

**Install on the edge first.** Copy catalogue.caddy, lease.sh, updating.html and install.sh to a staging directory on the Caddy VM and run install.sh there as root. It backs up and validates the Caddyfile and adds a reusable import inside both catalogue reverse-proxy handlers. Preserve port 8443's independent socket.io handler. Check the normal public catalogue status after reload. No active lease should exist.

**Activate the release hook second.** Back up seerr-social/ReconciliationRelease.cjs, then copy release-engine.cjs to that path for the existing deploy wrappers. Mini's scheduled deployment identity needs BatchMode SSH access to the lease helper on Caddy. Without it, the engine aborts before stopping Seerr. A lease expires after ten minutes even if its owner dies. Release health checks use the native Mini address; the final public health check runs after clearing the lease. Rollback renews the lease and clears it once the restored service passes its direct health check.

Deploy src/pages/_app.tsx and src/components/StatusChecker/MaintenanceBanner.tsx through the scoped release wrapper to enable the banner. Existing open pages need to have loaded this build to show the banner. A marked API 503 displays it; a successful status response dismisses it. No form reload or automatic write retry. Normal outages do not get the planned-update label.

To revert, restore the previous release engine, restore the edge Caddyfile backup and reload Caddy. The page itself reloads the same URL only after receiving a valid healthy catalogue response.

Validated on the same Caddy binary as production using test-edge.sh on a temporary loopback listener. The branded response body matched the standalone HTML byte for byte. API POST returned a marked JSON 503 without reaching the upstream, ordinary status forwarded normally, wrong-owner cleanup was ignored and an abandoned short test lease expired. Chrome tests confirmed reload at the original path/query/hash, banner recovery with an intact draft, and no replay of failed requests. These tests used isolated fixtures; they did not stop the production catalogue.
