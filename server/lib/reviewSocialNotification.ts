import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { MovieReview } from '@server/entity/MovieReview';
import { ReviewComment } from '@server/entity/ReviewInteraction';
import { User } from '@server/entity/User';
import { Notification } from '@server/lib/notifications';
import EmailAgent from '@server/lib/notifications/agents/email';
import WebPushAgent from '@server/lib/notifications/agents/webpush';
import logger from '@server/logger';
import { In } from 'typeorm';

export async function notifyReviewAuthor(
  id: string,
  actor: User,
  emoji?: string
) {
  try {
    const review = await getRepository(MovieReview).findOne({
      where: { id },
      relations: { user: { settings: true } },
    });
    if (!review?.user) return;
    const commenters = emoji
      ? []
      : await getRepository(ReviewComment)
          .createQueryBuilder('comment')
          .select('comment.userId', 'userId')
          .where('comment.reviewId = :id', { id })
          .distinct(true)
          .getRawMany();
    const ids = [
      ...new Set<number>([
        review.userId,
        ...commenters.map((c) => Number(c.userId)),
      ]),
    ].filter((userId) => userId !== actor.id);
    if (!ids.length) return;
    const recipients = await getRepository(User).find({
      where: { id: In(ids) },
      relations: { settings: true },
    });
    const query = new URLSearchParams({ comments: '1' });
    if (review.episodeNumber != null && review.seasonNumber != null) {
      query.set('reviewSeason', String(review.seasonNumber));
      query.set('reviewEpisode', String(review.episodeNumber));
    }
    const reviewUrl =
      `/${review.mediaType}/${review.tmdbId}?${query}#review-${encodeURIComponent(id)}`.replace(
        /%3A/g,
        ':'
      );
    let title = '';
    try {
      const tmdb = new TheMovieDb();
      title =
        review.mediaType === 'tv'
          ? (await tmdb.getTvShow({ tvId: review.tmdbId })).name
          : (await tmdb.getMovie({ movieId: review.tmdbId })).title;
    } catch {
      // Metadata failure must not prevent delivery of the comment notification.
    }
    if (title && review.seasonNumber != null && review.episodeNumber != null) {
      title += ` S${String(review.seasonNumber).padStart(2, '0')}E${String(review.episodeNumber).padStart(2, '0')}`;
    }
    const reviewLabel = title ? `${title} review` : 'review';
    for (const recipient of recipients) {
      const message = emoji
        ? `${actor.displayName} reacted ${emoji} to your ${reviewLabel}.`
        : recipient.id === review.userId
          ? `${actor.displayName} commented on your ${reviewLabel}.`
          : actor.id === review.userId
            ? `${actor.displayName} commented on their ${reviewLabel}.`
            : `${actor.displayName} commented on ${review.user.displayName}’s ${reviewLabel}.`;
      const payload = {
        subject: 'Multimeldia · ' + (emoji ? 'New reaction' : 'New comment'),
        message,
        reviewUrl,
        notifySystem: false,
        notifyAdmin: false,
        notifyUser: recipient,
      };
      await Promise.all(
        [new EmailAgent(), new WebPushAgent()]
          .filter((a) => a.shouldSend())
          .map(async (a) => {
            try {
              await a.send(Notification.SOCIAL_INTERACTIONS, payload);
            } catch (error) {
              logger.error('Review notification delivery failed', {
                label: 'Notifications',
                reviewId: id,
                recipientId: recipient.id,
                error: String(error),
              });
            }
          })
      );
    }
  } catch (error) {
    logger.error('Review notification delivery failed', {
      label: 'Notifications',
      reviewId: id,
      error: String(error),
    });
  }
}
