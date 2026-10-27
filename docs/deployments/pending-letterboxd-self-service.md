# Letterboxd self-service — 2026-10-27 (not deployed)

Users can access Letterboxd import in their own Linked Accounts settings, link
their username, control/check RSS, preview and import ZIP/CSV. Server checks
authorize self or admin for linking, RSS checks and import; cross-user access
remains forbidden. Owners see their account sync status. Unlink/delete imports
remains admin-only; changing an existing linked username still requires cleanup.
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
