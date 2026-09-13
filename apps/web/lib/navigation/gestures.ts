/** Native scroll and child controls own their gestures before page navigation. */
export function gestureAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return null;
  if (Math.abs(dx) > Math.abs(dy) * 1.3) return "x";
  if (Math.abs(dy) > Math.abs(dx) * 1.3) return "y";
  return null;
}

export function pageGestureBlocked(target: EventTarget | null, boundary: HTMLElement): boolean {
  if (!(target instanceof Element)) return true;
  if (document.body.style.overflow === "hidden" || document.body.hasAttribute("data-scroll-locked")) return true;
  if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return true;
  if (target.closest('[data-no-page-swipe], [data-no-pull-to-refresh], input, textarea, select, button, [contenteditable="true"], [role="slider"], video, audio, .leaflet-container, .mk-map-view, [data-mapkit]')) return true;
  for (let node: Element | null = target; node && node !== boundary; node = node.parentElement) {
    const style = getComputedStyle(node);
    if ((/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth) ||
        (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight)) return true;
  }
  return false;
}
