import type { ReactNode } from 'react';
import { useInView } from 'react-intersection-observer';

/** Mount nearby rows once; never discard their state when scrolling away. */
export default function DeferredSection({
  children,
  reserveLoadingSpace = false,
  placeholder,
}: {
  children: ReactNode;
  reserveLoadingSpace?: boolean;
  placeholder?: ReactNode;
}) {
  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin: '200px 0px',
    fallbackInView: true,
  });
  return (
    <div
      ref={ref}
      data-deferred-section={inView ? 'loaded' : 'waiting'}
      className={
        placeholder
          ? '[&:has([data-row-loading])>.row-content]:hidden [&:has([data-row-loading])>.row-placeholder]:block'
          : reserveLoadingSpace
            ? '[&:has([data-row-loading])]:min-h-96'
            : undefined
      }
    >
      {placeholder ? (
        <>
          <div className={`row-placeholder ${inView ? 'hidden' : ''}`}>
            {placeholder}
          </div>
          {inView && <div className="row-content">{children}</div>}
        </>
      ) : inView ? (
        children
      ) : (
        <div
          className="mb-8 h-96 animate-pulse rounded-lg bg-gray-800/30"
          role="status"
          aria-label="Loading section"
        />
      )}
    </div>
  );
}
