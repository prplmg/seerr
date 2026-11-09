import express, { type Express } from 'express';
// Export archives include base64 overhead. Route validators retain stricter
// limits for list snapshots/observations; HTTP must not reject valid envelopes.
export const LETTERBOXD_TRANSPORT_LIMIT = '15mb';
export function installLetterboxdBodyParsers(server: Express) {
  server.use(
    '/api/v1/reviews/import',
    express.json({ limit: LETTERBOXD_TRANSPORT_LIMIT })
  );
  server.use(
    '/api/v1/letterboxd-worker',
    express.json({ limit: LETTERBOXD_TRANSPORT_LIMIT })
  );
}
