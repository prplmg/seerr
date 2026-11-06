# Lists: discussion and decision queue — current status 2026-11-06

This status supersedes the historical proposals below. User requested one topic at a time. Only the new weekly-list system was deployed; unrelated local UI/data work remains pending. Latest request is documentation and discussion, not further implementation or deployment.

## Current agenda

1. **Automatic Letterboxd lifecycle — implemented and deployed.** Weekly complete eight-page anonymous census (first two pages of all-time/week/month/year); automatic cap560; persistent identity cache; resumable import; successful-probe-only retirement after14days absent, protecting saved/liked/owned lists. Personal list refresh remains separate. Old 60candidate/12active/2admission proposal superseded. Initial expedited pull completed:44lists,34added/10refreshed, all visible in Explore.
2. **Measurements and schedule — addressed.** Mini cohort benchmark and scheduler inspection informed Tuesday07:20–08:40 America/Merida, continuation on following mornings and heavy-work deferral. PRPL-PC one-off completed discovery+imports in10m28s; not a controlled hardware comparison and not proof of zero browsing overhead. Regular run remains on Mini. Detailed receipts: docs/benchmarks/weekly-lists-20261106 and weekly-bootstrap-20261106.
3. **Homepage rotation / full Explore visibility — implemented locally, not deployed.** User has now chosen identical cards for everyone:10general Letterboxd picks, distinct saved/created picks per eligible user, curated fillers to20, allowing overflow for user representation. Own/saved cards stay visible; private and unsafe content stays excluded. Daily order uses Merida date.9tests, server typecheck and lint passed; see daily-list-rotation-20261106.md. The following describes the still-live baseline until deployment: User requested a shared daily rotation for all users. Live selection has no daily rotation and still uses the old seed URLs for its nine preferred slots; the new44-list pool is available to Explore but has not replaced that preference rule. Discuss shared order versus strictly identical cards when hiding own/saved/liked lists; nine-plus-six distribution and exclusion behavior. Full Explore is the full eligible searchable pool, not a daily subset.
4. **Curated collection scope and provenance — pending.** Seven source organisations approved; earlier local11film additions to5existing collections still require keep/revert decision. Three local AFI ten-film collections need review; research batches for other approved sources are not complete. Those additions and provenance UI were not included in the weekly-only deployment.
5. **Media-detail design — pending.** Extend the existing collection card/button styling; review collection+lists, lists-only and series cases with realistic previews. Keep membership fetching on demand. Earlier plain preview was not accepted or deployed.
6. **Other browse UI and final delivery — partially pending.** Source/category filters, curated heading link, provenance display and old-card loading-flash fix remain local, outside the weekly deployment. Review individually; no blanket approval inferred. Weekly rollout/docs/initial pull are complete, not the whole backlog.

## Possible later TODO: PRPL-PC as primary weekly importer

User explicitly parked this idea; no implementation now. One-time follow-up scheduled for Wednesday November11 at10:00 Merida in this thread (`revisit-weekly-list-worker`), after the Tuesday run. Consider keeping Seerr scheduling controls on Mini while running fetching/parsing/film matching on PRPL-PC, then applying validated results on Mini. Proposed fallback is retrying during the maintenance window and only considering conservative Mini execution after a missed window; ownership/resume semantics need agreement before implementation. Avoid unnecessary complexity; reassess whether the normal cached weekly run needs this at all.

Actual one-off differences, not production changes:
- Removed the deliberate250ms delay before uncached title lookups in the isolated harness.
- Ran two lists concurrently instead of one scheduled automatic list outstanding.
- Explicitly ran outside the normal morning schedule; the isolated harness did not use the scheduler's heavy-job deferral or window-expiry checkpoints.
- Retained560cap, complete/public list validation, exclusions, HTTP bounds, successful-match caching, and preservation checks for personal data. It did not alter publishing or user toggles.

Thus "Mini conservative limits" meant normal pacing, single-list concurrency and maintenance-window/busy guards, not a smaller collection-size cap. Future off-host fallback is a proposal only. Production application remains b8c2536d; bootstrap receipt d0dc4d14.

---

## Historical discussion record (superseded where marked above)

# Lists: discussion and decision queue — 2026-11-06

User requested one topic at a time. Do not continue broad implementation or deploy while resolving this agenda. Existing work remains local. Preserve toggles. Limits below describe the pending implementation, not agreed optimal settings.

## 1. Automatic Letterboxd lists: complete lifecycle (CURRENT)

Questions to resolve together:
- Why 60 candidate URLs? Can/should the pool be larger?
- Which pages are fetched, how many URLs can each contribute, how are duplicates removed, and which previous candidates are displaced?
- What does 12 active automatic lists mean? How are the original 12 and later replacements chosen? What happens to lists leaving that pool?
- Distinguish URL discovery from full list import, subsequent refresh, public verification and UI selection.
- Explain exact request distribution, direct server HTTP vs browser fallback, and which PRPL-PC extension/profile handles each operation. Explicitly answer whether prplmg is required.
- Do arbitrary user-imported/saved lists auto-update? How do saved/liked/owned lists enter the queue?
- Why a budget of20? What happens when full? Explain the maximum2 new admissions with examples.
- How often runs occur, including scheduled and export-triggered calls; verify actual configured schedule/timezone before proposing clock times.
- Current known code: discovery once per24h, four public pages sequentially; title links only; fresh URLs then prior URLs deduplicated and capped60. Eleven seeds supplement candidates. Initial active pool uses already-imported seeds (up to12; only11seeds exist). Queue due after10h, oldest verification/attempt first then URL. Personal work first, active second, at most2new from remaining20slots. Successful admissions append; oldest admitted removed beyond12. Removed lists are not deleted and saved/liked/owned lists still receive personal refreshes. Public visibility expiry24h unchanged.
- Scheduler default for browser/watchlist job is every12h, but saved configuration can override it. Successful account export processing also invokes refresh; not strictly two invocations/day.
- Direct HTTP for discovery and public imports. Public personal-list failures can enter shared eligible extension queue, max2scans concurrently; not prplmg-only. Automatic discovery/imports currently have no browser fallback. All-time HTML parsed17candidates; weekly/landing anti-bot failures remain unresolved.
- 60/12/2 are conservative implementation choices, not benchmark-derived limits.20 predates this change; no performance proof established its optimality.

## 2. Measurement and automation schedule

- Test expanding beyond60 and refreshing a larger working pool before deciding limits.
- Separate cost of discovering URLs, fetching list pages and resolving titles; measure wall time, CPU/memory and catalogue responsiveness under representative conditions.
- Use isolated/read-only measurements; avoid changing live saved lists or scheduler controls.
- Decide frequency and best clock time with current jobs, Mérida/Melbourne usage and measured work duration. No arbitrary off-hours answer before inspection.

## 3. Homepage rotation and full Explore visibility

User decision: ALL USERS SHOULD RECEIVE THE SAME DAILY ROTATION. Pending code currently salts by user ID and needs revision after semantics discussed.
- Explain stable ordering in plain language: same order for unchanged input during a day, new order next day.
- Separate homepage row from full Explore page; full page is not a rotated subset.
- Explain nine popular + six mixed came from the earlier requested split, not per-user extensions/personalization.
- Resolve whether common rotation allows viewer-specific removals (own/saved/liked/activity duplicates) and resulting different visible cards, or requires identical cards for everyone.
- Classify exclusions: duplicated URLs, already saved/owned, activity-row overlap, private/stale/deleted, editorial blacklist. State which remain on full Explore. Do not conflate fetch deduplication with UI hiding.

## 4. Curated collection scope and source approval

- Explain why11films were added to5existing collections; acknowledge broad 'expand lists' interpretation and lack of explicit per-film approval.
- Show exact additions and before/after sizes: Courtroom23→26 (Witness for the Prosecution, Judgment at Nuremberg, Evil Angels/A Cry in the Dark); Screwball10→13 (Twentieth Century, Ball of Fire, Arsenic and Old Lace); Dark Animation20→21 (Fantastic Planet); Food31→34 (A Taste of Hunger, This Is Not What I Expected, The Taste of Things); Handmade21→22 (The Secret Adventures of Tom Thumb). Verify counts before final discussion.
- Decide keep/revert these additions; do not assume approval of source organisations means all proposed memberships are approved.
- Three new implemented sets: AFI Westerns, Fantasy, Epics10each. Other approved sources are not completed research batches. Present shortlist before further membership edits.
- Approved sources: AFI, DFI, Cinémathèque française, Cineteca Nacional México, Korean Film Archive, ACMI, Film at Lincoln Center. Preserve original vs editorial provenance for all collections.

## 5. Media-detail design

- User dislikes plain replacement preview. Revisit actual pre-existing collection card above media facts, including backdrop/style; extend that design rather than replacing it with a generic card.
- Show realistic movie collection + lists, movie without collection, series examples using actual components; obtain visual feedback before another redesign.
- Preserve existing collection destination. List lookup stays on-demand.

## 6. Final review and delivery

- Review filters, source links, old-card loading-flash fix and accumulated pending changes separately.
- Record each decision and benchmark result here; maintain scoped Git and Network docs.
- Deploy only on explicit instruction using established rollout protocol, unchanged toggles and no build polling.

### Point1 follow-up: 2026-11-06 measurements
User approved measuring before choosing limits and asked to include retirement of seasonal/short-lived lists. Read-only first-page/full-page/matching/store-scaling evidence saved in docs/benchmarks/list-discovery-20261106/report.md. First-page anonymous checks establish positive public evidence without all pages; HEAD/403 do not establish reliable status alone. Existing monolithic JSON and volatile2000film match cache are scaling concerns. No new operating limits, retirement rules, implementation or deployment approved by these measurements. Proposed retirement removes promotion separately from deletion and protects personal saves; exact retention and full Explore semantics remain open.

### Point1 proposal 2: weekly pool, two-week retention (discussion only)
- User proposes weekly discovery across popularity categories; retain recurring lists and retire/delete old unsaved automatic lists, possibly after two weeks.
- Recommended interpretation: expiry measured from last successful discovery sighting, not initial import; incomplete/challenged category runs cannot prove absence. Preserve saved/owned/liked lists independently.
- One weekly queued job can pace downloads rather than a simultaneous burst. Weekly frequency alone does not reduce peak matching/storage cost. Full-cohort import throughput remains unmeasured.
- Public all-time page inspected November6 has18 list cards and pagination; its lists range from135 to10988films. Number of pages/categories must be agreed; do not equate all discovery results with all Letterboxd lists. No verified total universe count.
- Consider deleting retired automatic-only contents/history while retaining minimal URL/last-seen metadata; protect personal references and avoid accumulating full snapshots for unsaved automatic lists. This is not approved or implemented.
- Outstanding: category/page depth, full-cohort cost, exact expiry/grace handling, saved-list refresh cadence and seasonal handling. No deployment or runtime changes.

### Point1 cohort test: 2026-11-06
User requested two pages each of weekly/monthly/yearly/all-time popularity and explicitly narrowed real imports to <=500items, with estimates above that. Browser census:144appearances,64unique URLs,81974memberships. Cutoffs250/500/1000/2000 retain32/43/52/56lists and4440/8717/15694/22205memberships. Exact isolated importer completed43/43 at500 in49.79min including27.67min pacing;147.9CPU seconds;8714matched entries plus3retained unmatched,5373unique media identities.250group took23.87min. Larger groups estimated90min/127min at same cost per entry, NOT executed. Direct discovery (both fetch and actual axios options) failed7/8pages with403; browser succeeded. Numeric filmlist URL is also skipped by current parser. Recommend500automatic cutoff and durable identity matching, awaiting agreement; no implementation or deployment. Full evidence:docs/benchmarks/list-cohort-20261106/report.md.

### Point1 scheduling follow-up: 2026-11-06
User selected maximum560items per automatic list (44lists/9219memberships in measured cohort), not implemented. Live scheduler/Plex/Windows/WSL/Tautulli inspection supports proposed Tuesday07:20–08:40 America/Merida, after Plex03:00–07:00 and before publication09:00. Melbourne00:20Wednesday during DST /23:20Tuesday standard. Weekday is a practical default, not measured traffic evidence. Require heavy-job overrun guard and resumability; continuation policy pending. Maintainerr was offline and not started. Full report:docs/benchmarks/list-schedule-20261106/report.md. No deployment or schedule changes.
