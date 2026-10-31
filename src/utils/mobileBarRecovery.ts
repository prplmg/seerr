/** Bounded, event-driven repaint after iOS returns from a native editor.
 * Does not move the page, override viewport offsets, or poll geometry. */
export function installMobileBarRecovery(
  recover: () => void,
  win: Window = window,
  doc: Document = document
) {
  const ios =
    /iPad|iPhone|iPod/.test(win.navigator.userAgent) ||
    (win.navigator.platform === 'MacIntel' && win.navigator.maxTouchPoints > 1);
  if (!ios || !win.visualViewport) return () => {};
  const viewport = win.visualViewport;
  let armed = false;
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
    if (!armed) return;
    timer = win.setTimeout(() => {
      // Do not remount while a keyboard is shrinking the visible area or zooming.
      if (!armed || viewport.scale !== 1 || viewport.height < baseline - 2)
        return;
      armed = false;
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
  return () => {
    win.clearTimeout(timer);
    doc.removeEventListener('focusin', focus);
    doc.removeEventListener('focusout', blur);
    viewport.removeEventListener('resize', schedule);
  };
}
