# Lists: discussion and decision queue — current status 2026-11-06

This status supersedes the historical proposals below. User requested one topic at a time. The weekly-list system and shared daily homepage rotation are deployed; unrelated local UI/data work remains pending. Latest request is documentation and discussion, not further implementation or deployment.

## Current agenda

1. **Automatic Letterboxd lifecycle — implemented and deployed.** Weekly complete eight-page anonymous census (first two pages of all-time/week/month/year); automatic cap560; persistent identity cache; resumable import; successful-probe-only retirement after14days absent, protecting saved/liked/owned lists. Personal list refresh remains separate. Old 60candidate/12active/2admission proposal superseded. Initial expedited pull completed:44lists,34added/10refreshed, all visible in Explore.
2. **Measurements and schedule — addressed.** Mini cohort benchmark and scheduler inspection informed Tuesday07:20–08:40 America/Merida, continuation on following mornings and heavy-work deferral. PRPL-PC one-off completed discovery+imports in10m28s; not a controlled hardware comparison and not proof of zero browsing overhead. Regular run remains on Mini. Detailed receipts: docs/benchmarks/weekly-lists-20261106 and weekly-bootstrap-20261106.
3. **Homepage rotation / full Explore visibility — deployed 2026-11-06.** User has now chosen identical cards for everyone:10general Letterboxd picks, distinct saved/created picks per eligible user, curated fillers to20, allowing overflow for user representation. Own/saved cards stay visible; private and unsafe content stays excluded. Daily order uses Merida date.9tests, server typecheck and lint passed; see daily-list-rotation-20261106.md. Build DYuikNjwqvrq5-au_dR2x now uses shared daily rotation; all6linked accounts verified identical20cards. The following describes the historical pre-deployment baseline: User requested a shared daily rotation for all users. Live selection has no daily rotation and still uses the old seed URLs for its nine preferred slots; the new44-list pool is available to Explore but has not replaced that preference rule. Discuss shared order versus strictly identical cards when hiding own/saved/liked lists; nine-plus-six distribution and exclusion behavior. Full Explore is the full eligible searchable pool, not a daily subset.
4. **Curated collection scope — parked.** Eleven additions to five existing lists were undone locally; never deployed. Three AFI drafts remain unapproved. User researching institutions. Preferred source byline: Multimeldia - British Film Institute. See docs/curation/undo-eleven-20261106.
5. **Media-detail design — deployed 2026-11-06.** Approved F split illustrated cards with stacked Lists edge. Current media backdrop for Lists; collection backdrop for Collection. On-demand memberships; build1tfaKYuStsQFI2bcT4dvo. See docs/deployments/media-lists-f-20261106.
6. **Browse filters — deployed 2026-11-06 (xZC3dpCZbwxFAKXuO4_Vr).** Source dropdown, curated heading→Explore, no legacy flash; additional removable media scope links from post-paint deferred nonempty media Lists cards (full-width stacked rows). Cached local membership measured on Mini. Source/provenance and curated content remain deferred. See docs/changes/explore-filters-20261106/.

## Possible later TODO: PRPL-PC as primary weekly importer

User explicitly parked this idea; no implementation now. One-time follow-up scheduled for Wednesday November11 at11:00 Merida in this thread (`revisit-weekly-list-worker`), after the Tuesday run. Consider keeping Seerr scheduling controls on Mini while running fetching/parsing/film matching on PRPL-PC, then applying validated results on Mini. Proposed fallback is retrying during the maintenance window and only considering conservative Mini execution after a missed window; ownership/resume semantics need agreement before implementation. Avoid unnecessary complexity; reassess whether the normal cached weekly run needs this at all.

Actual one-off differences, not production changes:
- Removed the deliberate250ms delay before uncached title lookups in the isolated harness.
- Ran two lists concurrently instead of one scheduled automatic list outstanding.
- Explicitly ran outside the normal morning schedule; the isolated harness did not use the scheduler's heavy-job deferral or window-expiry checkpoints.
- Retained560cap, complete/public list validation, exclusions, HTTP bounds, successful-match caching, and preservation checks for personal data. It did not alter publishing or user toggles.

Thus "Mini conservative limits" meant normal pacing, single-list concurrency and maintenance-window/busy guards, not a smaller collection-size cap. Future off-host fallback is a proposal only. Weekly bootstrap receipt d0dc4d14; subsequent shared-rotation deployment is build DYuikNjwqvrq5-au_dR2x (feature720d096d).

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


### 2026-11-06 — Curation clarification and reminder update

User clarified that expansion should mean new lists from the approved institutions, not primarily adding individually researched films to existing themes. The prior eleven-film/five-topic additions remain local and unresolved; do not treat this discussion as approval to deploy them. The three new AFI collections are only a partial batch, not completion of the seven-source request. Evidence for some individual additions came from other organisations, which does not constitute completed collections from those sources. Research should proceed across all seven approved organisations and present coherent source-backed new collections before membership changes.

Attribution clarification: the primary requirement is visible institution/source credit in the card's author/byline area, not a separate source-link panel. Proposed display (not implemented): institution name for an exact institutional selection; "Multimeldia · based on BFI" or similarly explicit credit for expanded selections, so additions are not attributed to the original institution. Preserve provenance URLs in the data; optional clickable byline/detail links are secondary. Existing source approvals stand; no new memberships or UI implementation approved by this discussion alone.

Reminder `revisit-weekly-list-worker` updated and verified: one-time Wednesday November11 at11:00 America/Merida. Discuss both off-host weekly execution and refresh semantics (unsaved qualifying discovery lists refresh weekly; saved/liked/owned lists get separate midnight/noon batch attempts; absent automatic-only lists follow retirement). No changes authorized by reminder.


### 2026-11-06 — Eleven additions undone; source byline confirmed

User requested setting aside the11individual additions. Removed exactly that November5batch from the pending seerr-fork dataset and its provenance, restored Food on Film's prior description and removed only newly introduced unused release-date entries. Five collection sizes restored: Courtroom23,Screwball10,Handmade21,Dark Animation20,Food31. They were not below a minimum threshold;11was a selected research batch, not a quota. All other collection objects, including the three AFI drafts, preserved byte-equivalently at the JSON-object level.118draft collections/2634memberships remain. Generator and curated regression validation pass. No production deployment/data change; live never included that batch. Exact reversible delta/receipt retained in docs/curation/undo-eleven-20261106; raw before snapshots in workspace outputs/curation-undo-20261106/before. This patch applies to the pending curation worktree, not the live baseline.

Preferred byline is now `Multimeldia - British Film Institute` (substitute full institution name), in the existing gray curated-author treatment. This supersedes earlier institution-only suggestions. UI not implemented in this turn. Keep detailed provenance distinct where selections have editorial additions.

Research sources: previous seven approvals remain AFI, Danish Film Institute, Cinémathèque française, Cineteca Nacional México, Korean Film Archive, ACMI Australia, Film at Lincoln Center. Add Cinemateca Brasileira (Brazil) to the research shortlist at user's request; official catalogue https://bases.cinemateca.org.br/ and programmes https://cinemateca.org.br/. BFI remains an existing source, separate from the seven-source expansion. Source approval does not approve arbitrary memberships. User will research independently; no broad new research/import or deployment started.
