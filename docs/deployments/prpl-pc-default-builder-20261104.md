# First production release using the default PRPL-PC builder

Build I7oD_eP5nYvI7Q3chOHtY is live. Implementation e57a6931. Source snapshot, compile, transfer, validation, Caddy lease, backup, switch and recovery checks ran through the normal catalogue deployment entrypoint. The live page and in-app banner say “It will only take a few moments.” The refresh icon uses the existing Heroicons arrow-path geometry.

PRPL-PC (native Windows x64) verified Node v22.23.2 and pnpm 10.24.0. Frozen install 12.488s; frontend and server compilation 40.903s. The artifact was 11,113,892 bytes. These are phase timings, not the full release duration or a measurement of browsing latency. No frontend or server compilation ran on Mini.

Mini verified the input, artifact and link-manifest digests, the build ID, and 31 exact package targets. Its isolated runtime rendered the login page, served three referenced JavaScript chunks, loaded compiled list/review code and queried SQLite in memory. Caddy then served the verified public maintenance page before Seerr stopped. Post-switch public login returned 200 with the expected build ID; review-reactor and recent-emoji APIs passed, all 31 live junctions resolved to the same expected packages, the lease cleared, account mappings/publishing settings matched. Previous build CsbO6Sm3RuLWMQNwauRQU is retained under C:/ProgramData/Seerr/catalogue-20261105013132060-32484-release/previous with backup/state evidence in the parent directory.

Input SHA256 f0b1978a506626544961847020c599f2ad8bd3da94615239b9875794b767df01
Artifact SHA256 9d8329bc553635f26c0a41de2c5db9190d2b68168e4c6b6bfa0291aa01339fbd
Link manifest SHA256 79f455999d8cbbd2cacccb709dcb6a198d7a71c52457ed9266e8885de63ec483

Normal releases use tools/build-host/deploy.cjs via the existing seerr-social/deploy-catalogue.cjs shim. There is no automatic fallback to compiling on Mini. Keep each release’s receipt.json, runtime-links.json, mini-preflight.json and verified.json for audit and rollback. No remote Git push.
