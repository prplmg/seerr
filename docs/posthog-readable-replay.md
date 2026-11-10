# Readable replay and event context — 2026-11-10

Local change, not deployed. Numeric user identity remains stable; PostHog person name and username identify the user. Events on movie/TV detail routes include media_type and media_id. All signed-in routes, including settings, allow replay.

Ordinary text and inputs are readable. SensitiveInput has a persistent credential marker, including when revealed. Password/hidden inputs and credential-named fields are blocked. Credential query parameters, URL credentials and share access tokens are redacted. Network bodies, headers and console recording remain disabled to avoid recording credentials outside form fields. Existing analytics mode selection remains unchanged.

Validation: local Chrome fixture using real components and a mocked SDK passed settings recording, username/media properties, ordinary input visibility, credential masking including reveal, and URL redaction. This validates app configuration, not a newly ingested production replay. Type/lint checks accompany the commit.

Caching: Next's current minimum optimized-image TTL is 14,400 seconds. Hashed assets already use long immutable caching. Proposed follow-up: longer caching for stable poster/backdrop URLs (e.g. 30 days), without globally extending mutable avatar caches. No cache policy changed here.

## Follow-up: artwork cache and action verification

The TMDB/TVDB image proxy now serves successful artwork for 30 days and retains newly fetched artwork with that TTL. Existing cached responses also receive the new browser TTL. Avatar handling and Next's global image setting are unchanged. Direct third-party image responses remain controlled by their origin; this policy applies only to images served through our proxy, not all image requests. No cacheImages toggle changed.

Local browser verification also clicked a tagged review action and asserted `catalogue_action` with `action: open_comments`. The other tagged actions are `open_reaction_picker` and `edit_review`. These are properties of a single event, not three event names. Automatic click capture is off. PostHog connector could not query live ingestion because its required link_id was unavailable; no claim of verified production receipt.
