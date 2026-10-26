import { Children, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

/** Keep two compact tools visible on phones; reveal the rest on wider screens. */
export default function DetailUtilityActions({
  children,
}: {
  children: ReactNode;
}) {
  const { locale } = useIntl();
  const actions = Children.toArray(children);
  if (!actions.length) return null;
  const label = locale.startsWith('es') ? 'Más acciones' : 'More actions';
  return (
    <div className="media-utility-actions">
      {actions.slice(0, 2)}
      {actions.length > 2 && (
        <>
          <div className="hidden gap-2 sm:flex">{actions.slice(2)}</div>
          <details className="media-other-actions sm:hidden">
            <summary aria-label={label} title={label}>
              <span aria-hidden="true">⋯</span>
            </summary>
            <div className="flex gap-2 p-3">{actions.slice(2)}</div>
          </details>
        </>
      )}
    </div>
  );
}
