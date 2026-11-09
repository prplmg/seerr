# List sharing preview cleanup — pending deployment

Removed decorative domain, “A list for you”, “Something worth watching” artwork copy and the private page's lilac subtitle. Removed “A collection worth exploring” from the public sign-in instructions. Public title/creator/count and posters remain; private previews still reveal no private list metadata. Centered the generic card illustration after removing its headline. Image URL version changed so newly fetched previews use updated artwork.

Server TypeScript and all three existing sharing/privacy route tests passed. Not deployed. Third-party messaging apps may retain already-cached previews after deployment.

Preview artwork and page header now use the actual home/sidebar logo_full.svg wordmark instead of rendered text. Logo rasterization is cached; both public and private previews verified with fresh screenshots. Image version3. Types and3sharing tests passed; still not deployed.
