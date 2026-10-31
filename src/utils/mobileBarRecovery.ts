/** Bounded, event-driven recovery for native-editor and scroll viewport drift.
 * Does not move the page, override viewport offsets, or poll geometry. */
export function installMobileBarRecovery(
  recover: () => void,
  win: Window = window,
  doc: Document = document,
  bar: () => HTMLElement | null = () => null
) {
  const ios =
    /iPad|iPhone|iPod/.test(win.navigator.userAgent) ||
    (win.navigator.platform === 'MacIntel' && win.navigator.maxTouchPoints > 1);
  if (!ios || !win.visualViewport) return () => {};
  const viewport = win.visualViewport;
  let armed = false;
  let driftRepairs = 0;
  let baseline = viewport.height;
  let timer: number | undefined;
  const editor = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    return (
      !!element &&
      typeof element.matches === 'function' &&
      (element.matches('input, textarea, select') || element.isContentEditable)
    );
  };
  const schedule = () => {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      // Do not remount while a keyboard is shrinking the visible area or zooming.
      if (viewport.scale !== 1 || editor(doc.activeElement)) return;
      if (armed) {
        if (viewport.height < baseline - 2) return;
        armed = false;
        driftRepairs = 0;
        recover();
        return;
      }
      const element = bar();
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const bottom = viewport.offsetTop + viewport.height;
      if (Math.abs(rect.bottom - bottom) <= 8) {
        driftRepairs = 0;
        return;
      }
      // At most two repairs until alignment is observed again. No scroll loop,
      // continuous polling, guessed transforms, or document scroll changes.
      if (driftRepairs >= 2) return;
      driftRepairs++;
      recover();
    }, 350);
  };
  const focus = (event: FocusEvent) => {
    if (!editor(event.target)) return;
    win.clearTimeout(timer);
    if (!armed) baseline = viewport.height;
    armed = true;
  };
  const blur = (event: FocusEvent) => {
    if (editor(event.target) && !editor(event.relatedTarget)) schedule();
  };
  doc.addEventListener('focusin', focus);
  doc.addEventListener('focusout', blur);
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('pageshow', schedule);
  return () => {
    win.clearTimeout(timer);
    doc.removeEventListener('focusin', focus);
    doc.removeEventListener('focusout', blur);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    win.removeEventListener('scroll', schedule);
    win.removeEventListener('pageshow', schedule);
  };
}
