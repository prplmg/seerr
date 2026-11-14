import dataSource from '@server/datasource';
import {
  LetterboxdExportAudit,
  LetterboxdExportBaseline,
} from '@server/entity/LetterboxdExport';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import {
  RecentReaction,
  ReviewComment,
  ReviewReaction,
} from '@server/entity/ReviewInteraction';
import { DiscoveryCacheSubscriber } from '@server/subscriber/DiscoveryCacheSubscriber';
import assert from 'node:assert/strict';
import { it } from 'node:test';

it('registers custom review, sync and discovery models with the application datasource', async () => {
  await dataSource.initialize();
  try {
    for (const entity of [
      MovieReview,
      LetterboxdAccount,
      LetterboxdExportBaseline,
      LetterboxdExportAudit,
      ReviewComment,
      ReviewReaction,
      RecentReaction,
    ]) {
      assert.equal(dataSource.hasMetadata(entity), true, entity.name);
      assert.equal(
        await dataSource.getRepository(entity).count(),
        0,
        entity.name
      );
    }
    assert.ok(
      dataSource.subscribers.some(
        (subscriber) => subscriber instanceof DiscoveryCacheSubscriber
      )
    );
  } finally {
    await dataSource.destroy();
  }
});
