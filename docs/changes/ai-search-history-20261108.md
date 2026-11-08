# AI search history polish — 2026-11-08

Local only; not deployed. Existing toggles unchanged.

- History displays relative time (minutes, hours, days), rather than a timestamp.
- A normalized prompt (case/whitespace ignored) has one history entry, regardless of filter or people variants. Explicit resubmission replaces that entry with the latest original search and group.
- Successful original submissions store generated filters. Chip edits and history reopens with stored filters neither create nor overwrite entries.
- Solo searches omit the people caption; groups retain `You + N`.
- Legacy variants collapse on read. Their filter provenance is unknown, so edited overrides are not replayed: reopening uses the existing cached prompt interpretation, then records a canonical entry. Normal seven-day cache expiry still applies; no production data migration was run.
- Per-user isolation, seven-day retention and serialized atomic file writes are unchanged.

Validation: five real-module history/API fixture tests passed with an isolated temporary config directory and mocked providers. Tests assert filter edits do not change history or call the model. ESLint and client/server TypeScript checks passed. Actual React Intl rendering verified `3 minutes ago`, `2 hours ago`, and `3 days ago`.
