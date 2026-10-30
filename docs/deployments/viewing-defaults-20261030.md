# Confirmed viewing consolidation and default association

User explicitly confirmed Plex iBoy and party iBoy are the same viewing. Live guarded SQLite transaction linked the existing synced local review's viewingEventId to the Plex event. Planner already excludes events claimed by local syncing reviews, preserving party receipt and remote identity; no remote writes or deleted rows. Backup C:/ProgramData/Seerr/data/iboy-viewing-consolidation-20261030.json. Narrow idempotent recovery helper in tools/recovery. Existing toggles unchanged.

Pending code: latest viewing returned with suggested flag when within 30 days and no rating at/after that viewing. All local and imported ratings participate. Text-only reviews do not suppress it; older ratings before a rewatch do not suppress it. Exact playback timestamp used where known, otherwise recorded diary calendar date at UTC midnight. Explicitly associated rated viewing never suggested again. New composer defaults to suggested viewing; editing an existing review preserves association. Linked playback uses existing external diary identity rather than offering a fresh diary create.

Five focused pure/helper tests passed, server typecheck passed. Older reviewsPublishing route harness fails before executing because its mock registry lacks existing reviewChronology import (unrelated to these changes); not counted as passing. UI layout hardening from previous turn remains pending. No deployment.

## Deployment

Deployed October30: build 3LA-0jWj6rRrY50fpv4vd. Four-file payload: recentUnratedViewing.ts, reviewEntrySelection.ts, Reviews/index.tsx and Reviews/StarPicker.tsx, byte-verified against checkpoint92917dbb04a4906178fa9f0256ce57723098f993 before deployment. Health/migrations passed; all six publishing settings/mappings unchanged. Rollback C:/ProgramData/Seerr/catalogue-20261030085121390-64776-release. Activity logging excluded. Includes preceding layout stabilization, whose exact native iPhone ghost-paint behavior remains unverified.

Live API verification: prplmg iBoy returns one authored review and suggested=false for consolidated October28 viewing, preserving its Letterboxd entry. Focus returns suggested=true for October29 viewing, no authored review, and its verified Letterboxd diary identity.
