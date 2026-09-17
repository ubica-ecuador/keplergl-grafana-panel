/**
 * Keeps a click on one of kepler's labels inside the panel it was made in.
 *
 * kepler's switches and checkboxes are a hidden `<input id>` and a
 * `<label htmlFor>`, with the id built from the layer's — `symbol-grafana-A-
 * upright-switch`. Two panels on one dashboard easily hold layers with the same
 * id: every auto-added layer on a `grafana-A` dataset gets one, and so does a
 * duplicated panel. The browser resolves `for` against the whole page, so a
 * click on the lower map's switch toggled the first input with that id — the
 * upper map's — and the lower one did nothing.
 *
 * Fixed here rather than in kepler's components because the same pattern runs
 * through its layer, filter and interaction panels alike.
 */

/**
 * The element a label click should reach instead of its default, or null when
 * the browser's own resolution is already right.
 */
export function misdirectedLabelTarget(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  const label = target instanceof Element ? target.closest('label') : null;
  if (!label || !root.contains(label) || !label.htmlFor) {
    return null;
  }
  const own = root.querySelector<HTMLElement>(`#${CSS.escape(label.htmlFor)}`);
  if (!own || own === root.ownerDocument.getElementById(label.htmlFor)) {
    return null;
  }
  return own;
}

/** Installs the redirect on a panel's root element; returns its removal. */
export function scopeLabelClicks(root: HTMLElement): () => void {
  const onClick = (event: MouseEvent) => {
    const own = misdirectedLabelTarget(root, event.target);
    if (!own) {
      return;
    }
    // The label's default would activate the other panel's input.
    event.preventDefault();
    own.click();
  };
  // Capture, so this runs before the browser's label activation.
  root.addEventListener('click', onClick, true);
  return () => root.removeEventListener('click', onClick, true);
}
