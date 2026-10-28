> Deployed 2026-10-27. Historical preparation notes below; see [verified live release](live-2026-10-27.md), including completed Zelza activation.

# Letterboxd self-service — 2026-10-27 (not deployed)

Users can access Letterboxd import in their own Linked Accounts settings, link
their username, preview and import ZIP/CSV. RSS controls/details are admin-only. Server checks
authorize self or admin for linking, RSS checks and import; cross-user access
remains forbidden. Linked accounts show a green Connected status and a disabled username input. Owners and admins can unlink/delete Letterboxd imports after confirmation; changing an existing linked username still requires cleanup.
No outbound publishing flags or existing account settings changed.

ZIP instruction links to https://letterboxd.com/user/exportdata/ in a new tab.
English/Spanish setup notice asks users to contact Melanie privately for full
integration; no password field is added. Admin Requests follow hiding remains
pending separately. Client/server typechecks and permission regression checks pass.

Restart checks: public/local catalogue HTTP 200, qBittorrent HTTP 200, Sonarr and
Radarr HTTP 200, Plex Movies/TV libraries accessible; Verity media range read
HTTP 206. Five bound Letterboxd accounts have recent heartbeats, publishing enabled.
Sonarr reports 1337x/Anime Tosho unavailable; Radarr reports 1337x unavailable
and legacy collection root E:\Movies missing. No settings changed.

Verity: Tautulli row 1071 records margoTica at 92% watched. Catalogue publishing
intent 450257b9-ad3e-4c8f-98d9-b74566d3c774 is dispatched without recovery/receipt;
no matching job exists in the active browser runtime database. This indicates
an incomplete delivery handoff; exact trigger is unproven. Do not blindly resend:
verify Letterboxd state first to avoid duplicate diary entries. No remote write retried.

## Connected-state refinement (pending, October 27)

Read-only accounts see the recent-activity copy with “(read only)”; fully
integrated accounts omit that qualification. Upload is hidden after the final
successful import batch or an existing complete export baseline. A nullable
importCompletedAt migration records future successful manual imports; historical
manual imports without a completion marker remain uploadable. Previews and failed
imports do not mark completion.

Owner/admin unlink disables that user's browser binding and outbound setting,
cancels queued writes through the existing write-state helper, and removes only
Letterboxd reviews/account/baseline. Local reviews and other sources remain. The
confirmation explicitly says Letterboxd itself is unaffected. No live accounts
or toggles were modified while implementing this. Nothing deployed.

The earlier operational snapshot above is historical; see
pending-durable-letterboxd-handoff.md for Verity recovery and Zelza's pending
post-deployment baseline/activation.
