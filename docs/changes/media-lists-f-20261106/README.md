# Media-detail Lists: approved F treatment — 2026-11-06

Implemented locally in seerr-fork; NOT deployed or pushed. User selected F after A–F previews.

- Collection and Lists use two equal-width illustrated cards when collection exists.
- Lists has two decorative rear layers; media without a collection gets full-width Lists.
- Collection uses its collection backdrop; Lists uses the media backdrop passed from MovieDetails/TvDetails. No new metadata request.
- Membership retrieval remains on opening the dialog, user-scoped. This work does not introduce eager membership checks to hide empty Lists; empty results remain handled in the dialog.
- No settings/toggles changed; unrelated dirty work preserved.

Validation: existing test-explore-list-sources.cjs passed; ESLint passed on all three components; actual MediaLists component server-rendered in local browser with image/user mocks. No full application end-to-end or production validation claimed.

component.patch captures only this turn's change to the previously untracked/pending MediaLists component. Integration adds backdropPath={data.backdropPath} to both existing MediaLists call sites. This receipt is not a deployable feature commit; the earlier pending media-list endpoint/component work must be isolated before release.
