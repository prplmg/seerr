# Deferred activity logging

Deferred by Melanie on 2026-10-29. Do not include activity logging in upcoming deployments unless explicitly requested again.

`activity-logging.patch` is the complete mail-format patch for commit e8ac5f2675ea30ee5ff70bd90d0e0d1b60e776f4, based on live source 0a9030a67ef90e7f9110bd831cfeba81316cea78. Apply with `git am` on a clean branch based on that commit, or review/rebase deliberately against a newer live baseline. Includes feature, tests, documentation and deployment file manifest. No copied account data or credentials.

Performance evidence and harness: branch bench/activity-logging-2026-10-28 at e68b513f33fa280f6114aa2038f70565aab8ba20; report docs/benchmarks/activity-logging-2026-10-28.md. Feature branch feature/user-activity also remains available. Typical overhead was small, not proven zero; retain the documented tail/rendering caveats.

No deployment. The active checkout still contains the pending activity implementation: automatic review rejected reverse-applying it to this dirty tree. Therefore do not deploy this checkout wholesale. Prepare releases from the verified live baseline and explicitly selected changes, excluding the activity file manifest and its integrations in routes/index.ts, seerr-api.yml, pages/_app.tsx and SettingsLayout.tsx. The patch is an archive, not authorization to enable logging.
