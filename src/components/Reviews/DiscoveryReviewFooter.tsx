import { usePartyText } from '@app/components/WatchParty/messages';
import { ChatBubbleOvalLeftIcon } from '@heroicons/react/24/outline';
import type { InteractionSummary } from './ReviewInteractions';

export default function DiscoveryReviewFooter({
  href,
  summary,
}: {
  href: string;
  summary?: InteractionSummary;
}) {
  const t = usePartyText();
  return (
    <a
      href={href}
      className="mt-auto flex flex-none items-center gap-2 pt-2 text-sm text-purple-200"
    >
      <span className="mr-auto">{t('Read more', 'Leer más')}</span>
      {summary?.reactions.slice(0, 2).map((r) => (
        <span
          key={r.emoji}
          className="rounded-full border border-gray-600 px-2 py-1"
        >
          {r.emoji} {r.count}
        </span>
      ))}
      <span
        aria-label={t('Comments', 'Comentarios')}
        className="inline-flex items-center gap-1 rounded-full border border-gray-600 px-2 py-1"
      >
        <ChatBubbleOvalLeftIcon className="h-4 w-4" />
        {summary?.comments ?? '…'}
      </span>
    </a>
  );
}
