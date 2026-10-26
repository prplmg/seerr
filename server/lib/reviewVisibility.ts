import type { MovieReview } from '@server/entity/MovieReview';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import { letterboxdEntryIdentity } from './letterboxdImport';
import { isBoundDiaryPair, type SyncReceipt } from './letterboxdSyncReceipts';
import type { FilmEvidence } from './letterboxdFilmEvidence';

export function visibleReviewEntries(
  q: SelectQueryBuilder<MovieReview>,
  repo: Repository<MovieReview>,
  receipts: readonly SyncReceipt[] = [],
  evidence: readonly FilmEvidence[] = []
) {
  q.andWhere("(review.text <> '' OR review.rating IS NOT NULL)");
  const duplicate = repo
    .createQueryBuilder('other')
    .select('1')
    .where(
      'other.userId = review.userId AND other.tmdbId = review.tmdbId AND other.mediaType = review.mediaType AND other.source = review.source AND other.entryKind = :diaryKind AND other.rating = review.rating'
    );
  // Keep distinct diary viewings and different ratings, hide only a redundant
  // summary. Watched-only records belong in avatars, not empty review cards.
  q.andWhere(
    `(review.entryKind <> 'summary' OR NOT EXISTS (${duplicate.getQuery()}))`,
    { diaryKind: 'diary' }
  );
  // Receipt originId is the local entity ID, NOT a publication revision ID.
  // Keep the authored local row; suppress only its explicitly linked LB echo.
  // Snapshot the visible candidates first so feed filters and summary hiding
  // cannot cause us to suppress an echo whose local counterpart is absent.
  const candidates = q.clone().select('review.id');
  evidence.filter(e => e.originId && e.watched && e.rating !== null).forEach((e, index) => {
    const prefix = `ratingEcho${index}`;
    const local = repo.createQueryBuilder('ratingOrigin').select('1')
      .where(`ratingOrigin.id = :${prefix}Origin`)
      .andWhere("ratingOrigin.source = 'local' AND ratingOrigin.text = ''")
      .andWhere('ratingOrigin.userId = review.userId AND ratingOrigin.tmdbId = review.tmdbId AND ratingOrigin.mediaType = review.mediaType AND ratingOrigin.rating = review.rating')
      .andWhere(`ratingOrigin.id IN (${candidates.getQuery()})`);
    q.andWhere(`NOT (review.source = 'letterboxd' AND review.entryKind = 'summary' AND review.userId = :${prefix}User AND review.rating = :${prefix}Rating AND EXISTS (${local.getQuery()}))`, {
      ...candidates.getParameters(), [`${prefix}Origin`]: e.originId, [`${prefix}User`]: e.userId, [`${prefix}Rating`]: e.rating,
    });
  });
  const links = receipts.filter((receipt) => {
    try {
      return (
        Number.isSafeInteger(receipt.userId) &&
        receipt.userId > 0 &&
        typeof receipt.originId === 'string' &&
        receipt.originId.length > 0 &&
        letterboxdEntryIdentity(receipt.entryId) === receipt.entryId &&
        new URL(receipt.entryId).pathname.split('/')[1] === receipt.account
      );
    } catch {
      return false;
    }
  });
  const unique = links.filter(
    (link, index) =>
      links.findIndex(
        (other) =>
          other.userId === link.userId &&
          other.originId === link.originId &&
          other.entryId === link.entryId
      ) === index &&
      !links.some(
        (other) =>
          other.userId === link.userId &&
          ((other.originId === link.originId &&
            other.entryId !== link.entryId) ||
            (other.entryId === link.entryId &&
              other.originId !== link.originId && !isBoundDiaryPair(other, link)))
      )
  );
  unique.forEach((receipt, index) => {
    const prefix = `reviewEcho${index}`;
    const local = repo
      .createQueryBuilder('echoOrigin')
      .select('1')
      .where(`echoOrigin.id = :${prefix}Origin`)
      .andWhere("echoOrigin.source = 'local'")
      .andWhere(
        'echoOrigin.userId = review.userId AND echoOrigin.tmdbId = review.tmdbId AND echoOrigin.mediaType = review.mediaType'
      )
      // A verified identity link survives edits on either side. Content equality
      // describes synchronization, not whether these are the same entry.
      .andWhere(`echoOrigin.id IN (${candidates.getQuery()})`);
    q.andWhere(
      `NOT (review.source = 'letterboxd' AND review.userId = :${prefix}User AND COALESCE(review.externalEntryId, '') = :${prefix}Entry AND EXISTS (${local.getQuery()}))`,
      {
        ...candidates.getParameters(),
        [`${prefix}User`]: receipt.userId,
        [`${prefix}Origin`]: receipt.originId,
        [`${prefix}Entry`]: receipt.entryId,
      }
    );
  });
  return q;
}
