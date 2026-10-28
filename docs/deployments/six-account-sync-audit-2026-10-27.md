# Six-account Letterboxd audit — 2026-10-27, 18:53–18:58 Mérida

Read-only inspection of catalogue state, read-only SQLite runtime inspection and six protocol probes with empty capabilities (no writes claimed). No browser verification jobs, publishing jobs, toggle changes or remediation performed. Server and runtime toggle hashes match before/after.

| Catalogue user | Letterboxd | Findings |
| --- | --- | --- |
| prplmg | prplmg | RSS/export/publishing state healthy; list delivery repeats HTTP 409. |
| ykrn | jairoheredia | Fresh heartbeat, successful complete export, runtime unpaused, no outstanding write/error state. |
| avellana | evegrissel | Same healthy readiness; one publishing transport timeout in preceding ten minutes; current no-write probe succeeded. |
| margoTica | margotnochill | RSS/export healthy and Verity publication verified; active runtime worker paused by failed follow-up read-only verification. |
| wampiro | beast199666 | Fresh heartbeat, successful complete export, runtime unpaused, no outstanding write/error state. |
| zelza | zelzingb | Complete recent export, runtime unpaused, publishing enabled; no outstanding errors. |

All six: RSS succeeded approximately eight minutes before initial sample, no RSS error; complete identity-matched baselines with zero holds; heartbeats 18–55 seconds old; extension 0.2.48 and InPrivate permission reported; no queued/dispatched/conflict/unknown catalogue write intents. No new publication was created to prove end-to-end write behavior; ykrn, wampiro and zelza have no verified write intent in current history. All six empty-capability delivery probes succeeded (434, 432, 1381, 485, 481, 1536 ms respectively). This establishes protocol readiness, not actual publication execution.

## Two exceptions

margoTica's **active** binding ec341dd0-6588-4619-9257-990ef754f142 has paused=1 and readonly_pauses points to 65314d8e-2f71-4390-a0de-e7fcf4af6dd8, a blocked review_observe with complete=false. It is not an obsolete profile row. The earlier Verity write 450257b9-ad3e-4c8f-98d9-b74566d3c774 is verified. Queue code pauses accounts on failed reads; only a newer successful identity/read check (with no newer uncertain mutation) clears that read-caused pause. No such check was launched because it could change the pause state, contrary to the user's keep-toggles-unchanged instruction. Server enabled=true alone does not mean publishing can execute.

prplmg's oldest unacknowledged list report 96d630fc-4488-45a9-ac56-13d0621ceb81 successfully read deskjet's Official Top 250 Narrative Feature Films (complete anonymous snapshot, 250 items). The server no longer contains this job ID. exchangeBrowserLists rejects it as Wrong list delivery; the client resends the oldest unacknowledged report before accepting new list work. Ten list HTTP 409 failures in ten minutes. Why the server record disappeared was not established. No report was discarded or resubmitted.

## Lessons and proposed follow-ups (not implemented)

1. Track effective readiness per account and per stage: RSS, browser identity/heartbeat, export baseline, runtime pause reason, delivery and list acknowledgements. A single latest global health sample can conceal another account's blocked stage.
2. Separate failed read checks from uncertain mutations. A harmless verification failure should not silently halt future publishing indefinitely; retain fail-closed behavior for uncertain writes/identity and require safe recovery evidence. Surface this pause in catalogue settings.
3. Retain durable completion/acknowledgement records for list deliveries; distinguish retired known jobs from invalid reports. Quarantine a repeatedly rejected report with a precise error, without silently discarding its snapshot or blocking unrelated imports forever.
4. Preflight archive freshness against imported updates before resolving 1000+ entries; request a fresh archive when stale. Persist verified film mappings/progress to avoid repeating expensive metadata work. Do not weaken newer-data protections.
5. Test real OpenAPI validation plus route/client negotiation, not only mocked route handlers; verify service process replacement and every active account after deployment. Keep no-capability probes to avoid test publications.

Hashes unchanged: server efc1909bb44d5c3b37c841fb3c0520d7f999a48524050cade273b7107ef89c5e; runtime 134a993f1c47db50d5105021f38f8e1b267cf08b2607726519c3ee9ad71893ce.
