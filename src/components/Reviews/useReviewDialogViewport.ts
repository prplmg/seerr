import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

/** Keep the comments sheet inside the visible area when the mobile keyboard opens. */
export function useReviewDialogViewport(
  open: boolean,
  content?: RefObject<HTMLDivElement | null>
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
    let frame = 0;
    const revealFocusedInput = () => {
      cancelAnimationFrame(frame);
      // Wait for React to apply the keyboard viewport height before measuring.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const container = content?.current;
          const input = document.activeElement;
          if (
            !container ||
            !(input instanceof HTMLElement) ||
            !container.contains(input) ||
            !input.matches('textarea, input')
          )
            return;
          const bounds = container.getBoundingClientRect();
          const field = input.getBoundingClientRect();
          const top = bounds.top + 12;
          const bottom = bounds.bottom - 12;
          if (field.top < top || field.height > bottom - top) {
            container.scrollTop += field.top - top;
          } else if (field.bottom > bottom) {
            container.scrollTop += field.bottom - bottom;
          }
        });
      });
    };
    const resize = () => {
      update();
      if (content) revealFocusedInput();
    };
    content?.current?.addEventListener('focusin', revealFocusedInput);
    const scrollContent = content?.current;
    update();
    visible?.addEventListener('resize', resize);
    visible?.addEventListener('scroll', update);
    window.addEventListener('resize', resize);
    return () => {
      visible?.removeEventListener('resize', resize);
      visible?.removeEventListener('scroll', update);
      window.removeEventListener('resize', resize);
      if (frame) cancelAnimationFrame(frame);
      scrollContent?.removeEventListener('focusin', revealFocusedInput);
      Object.assign(body.style, previous);
      window.scrollTo({ top: y, behavior: 'instant' });
    };
  }, [open, content]);
  return open ? viewport : undefined;
}
