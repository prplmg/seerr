import { TableColumn, type QueryRunner } from 'typeorm';

export async function expandReviews(q: QueryRunner) {
  await q.addColumns('movie_review', [
    new TableColumn({ name: 'mediaType', type: 'varchar', default: "'movie'" }),
    new TableColumn({ name: 'watched', type: 'boolean', default: false }),
    new TableColumn({ name: 'entryKind', type: 'varchar', default: "'diary'" }),
  ]);
  await q.query(
    `UPDATE movie_review SET watched = TRUE WHERE source = 'letterboxd'`
  );
  await q.query(
    `UPDATE movie_review SET "entryKind" = 'summary' WHERE source = 'letterboxd' AND text = '' AND "watchedDate" IS NULL`
  );
}
