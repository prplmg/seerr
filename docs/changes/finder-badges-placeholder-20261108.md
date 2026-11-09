# Finder badges and rotating AI Search examples

Status: implemented and tested locally; not deployed.

The finder omitted catalogue status from its result cards. TitleCard gates both availability and requester avatars on this status, so both were missing across sort modes, including lowest Letterboxd score. Completed POST and GET responses now hydrate their returned page through Media.getRelatedMedia, and the finder passes status to TitleCard. This is one local database lookup per completed page, not one external request per title. Progress-only checks do not query media. Cached job rows remain unchanged; current status is hydrated on delivery. Existing requester visibility rules remain in SocialPeople.

AI Search cycles these placeholders every eight seconds:
- Adult stop motion movies from the 2010s, under two hours, with a Letterboxd score between 3.5 and 4.5
- Esa peli de diego luna sobre futbol
- Series about sherlock holmes

Rotation pauses while focused, nonempty, or history is open; hidden tabs do not advance examples. Empty-input sizing reserves the longest example's space. Rotation causes no API or model calls.

Validation: six finder/API tests passed, including status hydration on fresh and cached response paths, movie/TV ID collision matching, no progress lookup and no cached-row mutation. Application and server typechecks and focused lint passed. Local Chrome with actual components and mocked data verified all three examples, eight-second timing, focus/text pause and resume, stable height, requester slots and no browser errors. Preview artifacts: outputs/finder-badges-placeholder-20261108 in the parent workspace. Native iPhone not tested.
