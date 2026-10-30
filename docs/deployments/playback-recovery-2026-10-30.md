# Bounded playback recovery — 2026-10-30

Scope: five server modules only. Activity logging stays removed/deferred; no UI or account configuration changes.

- Playback admission retains its two-event limit but fills free slots. A 15-minute lease rotates unresolved events out and defers them for another 15 minutes; immutable source events remain intact. Legacy batches expire on next admission. Configuration/enable-cycle changes invalidate retained slots. Continuation still observes only scheduled immutable snapshots.
- Observation requests share persisted per-scope retry history: 15-minute then 30-minute backoff, maximum three consecutive failed/ambiguous/expired reads. Exhausted evidence is retained for explicit reconciliation, never interpreted as absence/success. Other accounts/films remain independent. This deliberately requires investigation after exhaustion rather than indefinite automatic retries.
- A verified review acknowledgement may bind an undated local review to exactly one imported canonical diary echo only when account/media/entry identity and desired/local/imported rating/text/spoiler agree, with one verified playback receipt matching the exact diary date. Candidate construction makes no changes; normal acknowledgement validation and receipt commit happen before local projection update. No linking solely by title/date. Existing authored rows and party receipts are preserved.

Validation: 69 targeted tests passed across receipts, acknowledgement transaction, observation retry, playback provider/planner and restart-safe continuation; server typecheck passed. Includes later-event progress behind stalled legacy work, three-failure cap across repeated calls, identity mismatch and duplicate-echo rejection. Real recovery verification recorded after deployment. Does not promise elimination of external outages or infer equivalent Plex/party sessions from same-day dates.


Additional fairness: persist least-recently-attempted event ordering across lease expiry and restart, so more than four unresolved events cannot alternate indefinitely ahead of untried watches. Two-slot budget, cooldown, evidence guards remain unchanged. Six-stalled-event restart test confirms every event gets a turn.

First targeted release succeeded: build `fy21_EyXUTf8Yh9nqJ9o6`; rollback `C:/ProgramData/Seerr/catalogue-20261030080745105-62238-release`. Publishing settings and mappings preserved for all six linked users. Public health first attempt timed out, built-in retry passed. API verifies one prplmg iBoy review, synced, dated October 28. Focus admitted and its authenticated observation `ed1c8934-4af1-420a-885a-497c4df45215` claimed; publication not yet verified. Fair-ordering follow-up deployment in progress.


Live recovery verified: Focus intent `682d8ea0-f88d-4a2c-a078-c2483cc906ce` reached verified, with entry https://letterboxd.com/prplmg/film/focus-2015/ and desired watchedDate 2026-10-29, rewatch false. One intent, saved receipt, verified authenticated observation. No manual write replay. The separate iBoy Plex event remains held because matching date/title alone cannot prove equivalence to the party event; it no longer blocks subsequent watches.


Final five-module release succeeded: build `Lz5mt9WF2k8oGQVvLIdqS`; rollback `C:/ProgramData/Seerr/catalogue-20261030082030846-62763-release`. Health and migrations passed, all six publishing settings and mappings unchanged. Release payload contains only the five named sync modules; activity logging and unrelated UI changes excluded. Source checkpoint `9dbbb927a4626ea181f5c896503025234da2f158`, no push.
