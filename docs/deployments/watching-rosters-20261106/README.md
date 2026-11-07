# Watching now roster deployment — 2026-11-06

Live build `NpIVhVlX4RQQma3gxoDgC`; release `catalogue-20261107043851801-73592`. Source commits `86ded117` and `5a722864`. Only the four UI files in release.json were deployed; unrelated work excluded.

1–3 standalone viewers retain names; 4+ wrap as avatars. Other-party avatars wrap. Your own party uses +N to preserve playback controls. Cards keep consistent 152px mobile / 200px desktop height; multiple groups scroll internally. Detail rosters unchanged.

Five focused tests, client TypeScript and independent review passed. ESLint: zero errors, five existing image warnings. Actual-component mobile mock preview verified wrapping and own-party overflow before release. Single canonical PRPL-PC build completed (80.634s; install3.689s), 31 exact dependency links verified on Mini, staged login/chunks/SQLite checks passed. Branded maintenance page checked before stop, native API checked under lease, lease cleared and public health passed. Post-release source hashes match; all six user bindings/publication settings and three sync schedules unchanged. Real live party playback was not manipulated for testing.

Rollback: previous build `cWFQ5RLqwjN_gaZSJ26Pr` retained at `C:/ProgramData/Seerr/catalogue-20261107043851801-73592-release/previous`, with source manifest, DB/state backup and verified release evidence alongside it. Use the maintenance-aware rollback procedure. Full terminal log: workspace outputs/watching-rollout-20261106/rollout.log. No remote Git push.
