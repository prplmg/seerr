# Created-list sharing and collaboration

Implemented locally; not deployed. Applies only to Multimeldia-created lists, not imported Letterboxd lists or watchlists. No external writes, jobs or notification toggles changed.

- Share panel on the list detail page: direct authenticated catalogue link, Copy link, and native share sheet where supported.
- Owner assigns Can view / Can edit to existing catalogue users, or removes access with Not added. Explicit Save access persists the changes. Public links remain readable by signed-in users; private links grant no permission by themselves.
- Shared with you is an option in the existing My lists dropdown. Explicit grants appear automatically without requiring the recipient to open the link. Grants do not save the list or feed its contents into personal list recommendations. Revocation removes it from this section; public visibility remains public.
- Editors can change title, description and ordered movies, including bulk additions. Original author/owner are preserved. Only the owner changes visibility, manages collaborators or deletes the list. Viewer access is read-only. Server-side checks enforce all permissions, including after asynchronous metadata reads and immediately before writes.
- Existing lists need no migration: optional collaborators map defaults to no grants. Existing public/private and saved state are unchanged. All list access uses the shared visibility predicate. No anonymous access or invitation tokens.
- Content edits and sharing updates share the existing monotonic revision. Stale writes receive 409 and preserve local editor drafts; sharing drafts can be discarded/reloaded explicitly. Revoked users cannot save an old editor draft.

Validation: 25 focused domain and actual-OpenAPI API tests passed. Broader related suite: 39 passed, one pre-existing discovery preview expectation failed (expects one explore result, receives zero). Reproduced the identical failure using the unchanged HEAD discovery route; unrelated to sharing and not altered. Both application/server typechecks and focused lint passed. Local Chrome tested actual Share component with mocked users: viewer/editor assignments, removal, refreshed revision, no horizontal overflow at 390 px and no browser errors. Mobile/desktop previews in parent workspace outputs/list-sharing-20261108/. Native OS sharing not tested on physical devices.

No push or production deployment performed. Existing pending finder-badge/placeholder commit remains separate; next-env.d.ts remains excluded.
