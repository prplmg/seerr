import { useRouter } from 'next/router';
import { useState } from 'react';
export default function FilteredPick({
  pick,
  disabled,
}: {
  pick: () => Promise<{ id: number; mediaType: string } | undefined>;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="my-3">
      <button
        disabled={disabled || busy}
        className="rounded-full border border-purple-400 px-4 py-2 text-sm text-purple-200 disabled:opacity-40"
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
        {busy ? 'Choosing…' : 'Pick for me'}
      </button>
      {error && <p role="status">{error}</p>}
    </div>
  );
}
