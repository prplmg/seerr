# Pending: admin Requests follow control

2026-10-26: Remove FollowReleases from RequestItem, used by the admin Requests
view. Retain the existing desktop card height. Normal-user RequestCard,
Discovery cards, media details, subscription permissions and toggles unchanged.
Client typecheck and formatting check passed. Not deployed.

Operational cleanup: removed only obsolete Love Is Blind UK S2E9 torrent
27520604f59b4ae66cbb4f8aeef569cf446d7045 with deleteFiles=false. Verified
replacement still imported with unchanged Sonarr episodeFileId 3535.
