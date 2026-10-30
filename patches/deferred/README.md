# Deferred activity logging

Deferred by Melanie on 2026-10-29. Do not include activity logging in upcoming deployments unless explicitly requested again.

`activity-logging.patch` is the complete mail-format patch for commit e8ac5f2675ea30ee5ff70bd90d0e0d1b60e776f4, based on live source 0a9030a67ef90e7f9110bd831cfeba81316cea78. Apply with `git am` on a clean branch based on that commit, or review/rebase deliberately against a newer live baseline. Includes feature, tests, documentation and deployment file manifest. No copied account data or credentials.

Performance evidence and harness: branch bench/activity-logging-2026-10-28 at e68b513f33fa280f6114aa2038f70565aab8ba20; report docs/benchmarks/activity-logging-2026-10-28.md. Feature branch feature/user-activity also remains available. Typical overhead was small, not proven zero; retain the documented tail/rendering caveats.

No deployment. On 2026-10-29 Melanie explicitly approved removal from the active checkout. The exact reverse patch passed its check and was applied; all affected paths were verified against the pre-feature baseline. Unrelated pending changes were preserved. The archived patch and feature/benchmark branches remain available. Do not restore or deploy activity logging unless explicitly requested.
