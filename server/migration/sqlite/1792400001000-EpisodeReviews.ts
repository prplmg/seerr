import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';
export class EpisodeReviews1792400001000 implements MigrationInterface {
  async up(q: QueryRunner) {
    for (const [name, type] of [
      ['seasonNumber', 'integer'],
      ['episodeNumber', 'integer'],
      ['episodeName', 'varchar'],
    ])
      await q.addColumn(
        'movie_review',
        new TableColumn({ name, type, isNullable: true })
      );
  }
  async down(q: QueryRunner) {
    for (const name of ['episodeName', 'episodeNumber', 'seasonNumber'])
      await q.dropColumn('movie_review', name);
  }
}
