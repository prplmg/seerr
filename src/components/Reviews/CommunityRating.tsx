import Tooltip from '@app/components/Common/Tooltip';
import { usePartyText } from '@app/components/WatchParty/messages';
import { StarIcon } from '@heroicons/react/24/solid';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

export const communityRatingKey = (id: number, type: 'movie' | 'tv') =>
  `/api/v1/reviews/average/${id}?mediaType=${type}`;

export default function CommunityRating({
  id,
  mediaType,
}: {
  id: number;
  mediaType: 'movie' | 'tv';
}) {
  const t = usePartyText();
  const intl = useIntl();
  const { data } = useSWR<{ average: number | null; count: number }>(
    communityRatingKey(id, mediaType)
  );
  const score =
    data?.average == null
      ? '—'
      : intl.formatNumber(data.average, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
  const label = data?.count
    ? t(
        `Multimeldia: ${score}/5 · ${data.count} members · latest rating per member`,
        `Multimeldia: ${score}/5 · ${data.count} miembros · última calificación por miembro`
      )
    : t(
        'Multimeldia: no ratings yet',
        'Multimeldia: aún no hay calificaciones'
      );
  return (
    <Tooltip content={label}>
      <a
        href="#reviews"
        aria-label={label}
        className="media-rating whitespace-nowrap"
        style={{ color: '#d8b4fe' }}
      >
        <StarIcon aria-hidden="true" className="h-6 w-6 shrink-0" />
        <span>{score}</span>
      </a>
    </Tooltip>
  );
}
