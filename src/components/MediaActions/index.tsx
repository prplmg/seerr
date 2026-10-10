import Button from '@app/components/Common/Button';
import type { PlayButtonLink } from '@app/components/Common/PlayButton';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import { FilmIcon } from '@heroicons/react/24/outline';
import { MediaServerType } from '@server/constants/server';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaActions', {
  trailer: 'Trailer',
  letterboxd: 'Open in Letterboxd',
});

const MediaActions = ({
  links,
  trailerUrl,
  movieId,
}: {
  links: PlayButtonLink[];
  trailerUrl?: string;
  movieId?: number;
}) => {
  const intl = useIntl();
  const settings = useSettings();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <Button
          key={link.url}
          as="a"
          buttonType="ghost"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={link.text}
          aria-label={link.text}
        >
          {settings.currentSettings.mediaServerType === MediaServerType.PLEX ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path fill="#E5A00D" d="M5 2h7l7 10-7 10H5l7-10z" />
            </svg>
          ) : (
            link.svg
          )}
          {link.text.includes('4K') && <span>4K</span>}
        </Button>
      ))}
      {trailerUrl && (
        <Button
          as="a"
          buttonType="ghost"
          href={trailerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FilmIcon aria-hidden="true" />
          <span>{intl.formatMessage(messages.trailer)}</span>
        </Button>
      )}
      {movieId && (
        <Button
          as="a"
          buttonType="ghost"
          href={`https://letterboxd.com/tmdb/${movieId}/`}
          target="_blank"
          rel="noopener noreferrer"
          title={intl.formatMessage(messages.letterboxd)}
          aria-label={intl.formatMessage(messages.letterboxd)}
        >
          <svg viewBox="0 0 32 24" className="h-5 w-5" aria-hidden="true">
            <circle cx="8" cy="12" r="7" fill="#FF8000" />
            <circle cx="16" cy="12" r="7" fill="#00E054" />
            <circle cx="24" cy="12" r="7" fill="#40BCF4" />
          </svg>
        </Button>
      )}
    </div>
  );
};
export default MediaActions;
