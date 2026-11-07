# AI Search people and compact results — local only

Not deployed. Existing production build remains zuA42wr8PmtWqIRWVpXCJ. No service, credential, publication or schedule changes. No paid AI calls made for this change.

## People

Added a compact expandable people selector using discoveryData's same visibility-filtered users as Watch Together. Self is included; at most five additional people. Explicit selection forces unwatched results for everyone in the group. POST accepts validated people IDs; unknown/hidden/ambiguous/oversized selections fail. Group history outages fail explicitly. Visibility is rechecked before returning results.

Extracted togetherSeen from Watch Together recommendation exclusions so both paths share watched/rated membership semantics. Existing discoveryData supplies the attributed Plex/co-viewing/review history; no per-person upstream history request or history upload to OpenAI. Selection changes reuse the same per-user/query interpretation cache and only apply filtering locally on submit. The narrow English phrase “unwatched by ykrn and I” (also me, case-insensitive visible names) resolves locally and is replaced with “unwatched” before model submission. Ambiguous/missing names direct users to the selector. Arbitrary natural-language name parsing is not promised.

## Usage (deliberately minimal)

Existing logger records user ID, model, outcome and sanitized returned input/output/total/cached-input/cache-write/reasoning counts. No prompts, titles, participant IDs, key, raw provider response or error object. Cache hits record zero; provider failures/missing fields record null (unknown). Returned usage from invalid/incomplete output is still counted. No database, dashboard, cost ledger or extra API call. Logs use existing retention (human log7days, machine log1day); OpenAI's dashboard remains authoritative for billing and historical totals. Old unrecorded usage cannot be recovered here.

## UI and notes

Removed the subtitle and pre-results shortlist disclaimer; footer copy is “AI makes mistakes. Edit to refine results”. Placeholder covers horror/similarity, decade, runtime, availability and unwatched group. Selection is reflected in result chips. Runtime-constrained results carry the already-fetched duration to the bottom-right posterBadge; series duration remains episode runtime.

Old prompt explicitly requested unsupported-constraint notes, including other users' histories. The reported “cannot be a filter” text is consistent with this free-form model note (exact user response not retained). Revised instructions treat mood/tone/pacing/similarity as subjective suggestions, acknowledge locally applied history/availability filters, and reserve notes for genuinely unchecked objective constraints. This changes prompting, not suppression of all genuine limitations; mocked tests cannot guarantee model wording.

Letterboxd score filtering/badges remain unimplemented. Recommended later: use existing cached scores after candidate resolution, visibly distinguish missing scores, and offer bounded lookup rather than blocking every search or silently dropping unknowns. A bounded shortlist can miss qualifying titles regardless of score sorting.

## Verification

23 focused tests passed, including existing Watch Together regressions, identity/privacy/bounds, grouped watched exclusion, cache reuse with changed group, duration response and log sanitization. Server/client typechecks, focused lint and diff check passed. Actual page/TitleCard fixtures checked at320/390/1440px: no horizontal overflow, no AI call while typing/selecting, selected people included on submit, and duration badges rendered. Evidence outputs/ai-search-group-20261107. No production deploy or Git push.

Follow-up: placeholder now says “unwatched by prplmg and I”, as requested. Copy-only change; diff check passed. Still not deployed.
