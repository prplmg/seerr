import Button from '@app/components/Common/Button';
import { usePartyText } from '@app/components/WatchParty/messages';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/router';
import { useState } from 'react';

export default function RandomPickButton({
  exclude,
  again = false,
}: {
  exclude?: number;
  again?: boolean;
}) {
  const t = usePartyText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        buttonType="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const response = await fetch(
              `/api/v1/curated/random${exclude ? `?exclude=${exclude}` : ''}`,
              { cache: 'no-store' }
            );
            if (!response.ok) throw Error('Failed');
            const { result } = await response.json();
            if (!result) {
              setError(
                t(
                  'No other available titles found.',
                  'No se encontraron otros títulos disponibles.'
                )
              );
              return;
            }
            await router.push(
              `/${result.mediaType === 'movie' ? 'movie' : 'tv'}/${result.tmdbId}?random=1`
            );
          } catch {
            setError(
              t(
                'Could not pick a title. Try again.',
                'No se pudo elegir un título. Inténtalo de nuevo.'
              )
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <ArrowPathIcon />
        <span>
          {busy
            ? t('Choosing…', 'Eligiendo…')
            : again
              ? t('Another pick', 'Elegir otro')
              : t('Pick something available', 'Elegir algo disponible')}
        </span>
      </Button>
      {error && (
        <p role="status" className="text-sm text-yellow-300">
          {error}
        </p>
      )}
    </div>
  );
}
