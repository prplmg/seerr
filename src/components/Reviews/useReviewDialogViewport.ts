import { useEffect, useState, type CSSProperties } from 'react';

/** Keep the comments sheet inside the visible area when the mobile keyboard opens. */
export function useReviewDialogViewport(
  open: boolean
): CSSProperties | undefined {
  const [viewport, setViewport] = useState<CSSProperties>();
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const y = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    const visible = window.visualViewport;
    const update = () =>
      setViewport({
        top: visible?.offsetTop ?? 0,
        height: visible?.height ?? window.innerHeight,
      });
    update();
    visible?.addEventListener('resize', update);
    visible?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      visible?.removeEventListener('resize', update);
      visible?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      Object.assign(body.style, previous);
      window.scrollTo({ top: y, behavior: 'instant' });
    };
  }, [open]);
  return open ? viewport : undefined;
}
