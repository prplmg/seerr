import { getRepository } from '@server/datasource';
import { MovieReview } from '@server/entity/MovieReview';
import type { User } from '@server/entity/User';
import { Notification } from '@server/lib/notifications';
import EmailAgent from '@server/lib/notifications/agents/email';
import WebPushAgent from '@server/lib/notifications/agents/webpush';
import logger from '@server/logger';

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
    if (!review?.user || review.userId === actor.id) return;
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
    const message = emoji
      ? `${actor.displayName} reacted ${emoji} to your review.`
      : `${actor.displayName} commented on your review.`;
    const payload = {
      subject: 'Multimeldia · ' + (emoji ? 'New reaction' : 'New comment'),
      message,
      reviewUrl,
      notifySystem: false,
      notifyAdmin: false,
      notifyUser: review.user,
    };
    await Promise.all(
      [new EmailAgent(), new WebPushAgent()]
        .filter((a) => a.shouldSend())
        .map((a) => a.send(Notification.SOCIAL_INTERACTIONS, payload))
    );
  } catch (error) {
    logger.error('Review notification delivery failed', {
      label: 'Notifications',
      reviewId: id,
      error: String(error),
    });
  }
}
