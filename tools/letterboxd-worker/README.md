# Canonical Letterboxd worker

`catalogue_client.py` and `queue_store.py` here are the release sources. The weekly tools reference them via symlinks; stage the dereferenced contents on Windows. Never deploy the historical seerr-social copies or vendor a second bridge.

Before a release run both worker and weekly Python suites plus list-browser.test.cjs. The compatibility test reads the released extension manifest and exercises capability negotiation and a real queue claim. Preserve blocked/unknown write reconciliation; do not replace a live bridge with an older weekly-only copy.

`install-release.py` stages both files with expected current SHA256 hashes, requires idle jobs, backs up source, preserves account/configuration state, and restarts only the bridge task. Credentials remain on the host.
