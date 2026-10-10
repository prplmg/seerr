import SlideOver from '@app/components/Common/SlideOver';
import DownloadBlock from '@app/components/DownloadBlock';
import StatusBadge from '@app/components/StatusBadge';
import defineMessages from '@app/utils/defineMessages';
import { useEffect, useState, type ComponentProps } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.DownloadProgressBadge', {
  progress: 'Download Progress',
});

// Reuse only progress already supplied by the authenticated media response.
// No request-management APIs or controls are exposed by this drawer.
const DownloadProgressBadge = (props: ComponentProps<typeof StatusBadge>) => {
  const [open, setOpen] = useState(false);
  const intl = useIntl();
  const items = props.downloadItem ?? [];
  const downloading = items.length > 0;
  useEffect(() => {
    if (!downloading) setOpen(false);
  }, [downloading]);
  const badge = <StatusBadge {...props} readOnly />;
  if (!downloading) return badge;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={intl.formatMessage(messages.progress)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        {badge}
      </button>
      <SlideOver
        show={open}
        onClose={() => setOpen(false)}
        title={intl.formatMessage(messages.progress)}
      >
        <div role="region" aria-label={intl.formatMessage(messages.progress)}>
          {items.map((item, index) => (
            <DownloadBlock
              key={`${item.downloadId}-${item.externalId}-${index}`}
              downloadItem={item}
              is4k={props.is4k}
              title={
                Array.isArray(props.title) ? props.title[index] : props.title
              }
            />
          ))}
        </div>
      </SlideOver>
    </>
  );
};
export default DownloadProgressBadge;
