import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/router';
import { useState } from 'react';
export default function FilteredPick({
  pick,
  disabled,
  className = 'my-3',
}: {
  pick: () => Promise<{ id: number; mediaType: string } | undefined>;
  disabled: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className={className}>
      <button
        disabled={disabled || busy}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-purple-400 px-3 py-2 text-sm text-purple-200 disabled:opacity-40"
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const media = await pick();
            if (media) await router.push(`/${media.mediaType}/${media.id}`);
            else setError('No matching titles.');
          } catch {
            setError('Could not pick a title. Try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <ArrowPathIcon
          className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        {busy ? 'Choosing…' : 'Pick for me'}
      </button>
      {error && <p role="status">{error}</p>}
    </div>
  );
}
