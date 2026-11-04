# Catalogue review interactions release · 2026-11-04

Production build CBcbb1TcGfxbMVBYexz-1, source c192e8c4. Public health, database migrations, a recent review's interaction summary and comment thread, the Unlinked endpoint and existing movie/series checks passed. Existing account mappings and publishing settings matched their pre-release values.

Reviews and comments support local emoji reactions. Recent reviews opens an in-place picker or comment sheet. Created lists start saved, and unsaving moves them into Unlinked. Missing cover cards are suppressed and o_zero’s short-films-on-youtube list is excluded. No curator link imports or external comment publication.

Previous build 20cM2gc74VAenO7yfSEkH and the pre-release database backup are retained under C:/ProgramData/Seerr/catalogue-20261104230239446-24534-release. Browser interaction and mutation tests used local fixtures; production verification was read-only. No remote Git push.
