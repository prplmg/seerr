# Letterboxd ranges and expanding AI Search input

Local only; no deployment, push, paid AI requests or live toggle changes. Extends the pending LB-filter implementation7848b684.

Maximum Letterboxd score is now supported alongside minimum and inclusive ranges. Natural-language plan/schema, validated local filter application, editable chip, history labels and score-collection trigger all handle either/both bounds. Inverted or out-of-scale ranges are rejected, unknown scores remain excluded, and zero is valid. A maximum-only constraint triggers collection just like minimum-only. Both use the same score lookups, shared four-worker queue/cache and existing deadlines; no extra scoring work per bound. Editing cached filters makes no new model call. Prompt changes intentionally invalidate old interpretation-cache keys.

The placeholder now reads: “A horror movie like The Witch, from the 2010s, under two hours, available and unwatched by prplmg and I, with a Letterboxd score between 3.5 and 4.5…”

Textarea starts at four rows/min128px and automatically measures current text or placeholder, including responsive width changes and returning from History. It grows to320px then scrolls for long queries. A hidden measurement clone uses identical styles/width and is removed immediately; no timer, network request or persistent hidden input. Longer placeholder text did not previously expand the fixed-three-row input automatically.

17 focused unit/API tests pass, including maximum-only, inclusive endpoints, zero, invalid/inverted ranges, unknown-score exclusion, and cached edits without AI calls. Client/server types, lint and diff checks pass. Mocked real-component browser checks at320/390/1440px verify complete placeholder visibility, bounded input growth, range submission, History preservation and no horizontal overflow. No repeat external-score benchmark needed: the queue/lookup workload is unchanged. Evidence outputs/ai-search-range-20261107. Existing unrelated next-env.d.ts preserved.
