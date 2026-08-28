/** What kepler tells a layer about the split-map pane being drawn. */
export interface PaneVerdict {
  /**
   * kepler's `renderDeckGlLayer` works this out as
   * `!mapLayers || mapLayers[layer.id]`, where `mapLayers` is the pane's own
   * list of layers. Absent when the caller is not drawing a pane at all.
   */
  visible?: boolean;
}

/**
 * Whether the pane kepler is drawing should show this layer.
 *
 * A layer switches *itself* off: kepler hands every layer to deck whether or
 * not the pane shows it, and expects each one to read this verdict — which is
 * what `getDefaultDeckLayerProps` does for the layers that build their props
 * through it. A layer that builds its own props, as the tileset layers here
 * do, has to apply it by hand or the split-map eyes change the state and
 * switch nothing off.
 *
 * The verdict has three shapes, not two. `true` and `false` mean what they
 * say. `undefined` arrives from the pane kepler deliberately leaves empty when
 * the map is first split: its list has no entry for the layer, so the lookup
 * yields `undefined` rather than `false`. deck reads that as its default —
 * visible — so the pane meant to start empty draws everything, and a split
 * screen opens with two identical halves. Reading it as "not listed, so not
 * drawn" is what makes the two halves separable in one click.
 *
 * The key being absent altogether is different again: a caller outside the
 * split path is not hiding the layer, it simply has no pane to speak for.
 */
export function shownInPane(opts?: PaneVerdict): boolean {
  if (!opts || !('visible' in opts)) {
    return true;
  }
  return opts.visible === true;
}
