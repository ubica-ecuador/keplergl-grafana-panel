/**
 * Puts the layer order back after a data refresh reshuffled it.
 *
 * `replaceDataInMap` parks a dataset's layers, rebuilds the dataset and merges
 * the layers back in an order it preserved beforehand. A refresh replaces every
 * query's dataset one after another, and the merge of the first lands after the
 * second has been prepared — which overwrites the preserved order with the
 * second dataset's own layer list, empty when it has no layers. The first
 * dataset's layers then come back reversed: a heatmap meant to sit under the
 * points ends up on top of them (`replaceDatasetDepsInState` in
 * @kepler.gl/reducers).
 *
 * keplergl/kepler.gl#3728, released in 3.3.0-alpha.12, fixed only half of it:
 * the overwrite is skipped when the second dataset parks nothing, and still
 * happens when it has layers of its own — the list it writes is then those
 * layers alone, since the first dataset's are parked and no longer in the
 * state it reads. Measured on alpha.12 with points and a heatmap on one query
 * and a layer on another: the first two swapped on 12 refreshes out of 12.
 *
 * Free of kepler and React so the decision can be tested with literal values.
 * The caller captures the order before refreshing and dispatches what this
 * returns.
 */

/** An entry of kepler's `visState.layerOrder`: a layer id, or a layer group. */
export type LayerOrderEntry = string | { id: string; layerOrder?: unknown[] };

export type LayerOrderAction = { kind: 'wait' } | { kind: 'done' } | { kind: 'restore'; order: string[] };

export function decideLayerOrderRestore({
  expected,
  layerOrder,
  pending,
}: {
  /** The order the map had before the refresh. */
  expected: LayerOrderEntry[];
  /** kepler's current `visState.layerOrder`. */
  layerOrder: LayerOrderEntry[];
  /**
   * Layers the refresh parked that kepler has not merged back yet. Layers that
   * were already pending before it — a saved layer whose dataset never arrived —
   * must not be counted, or the wait would never end.
   */
  pending: number;
}): LayerOrderAction {
  if (pending > 0) {
    return { kind: 'wait' };
  }
  // A group nests ids inside an object; a flat reorder would dissolve it, and
  // kepler's merge restores grouped orders on its own.
  if (!expected.every(isLayerId) || !layerOrder.every(isLayerId)) {
    return { kind: 'done' };
  }
  // A different set of layers means someone edited the map meanwhile; the old
  // order no longer describes it, and forcing it would undo that edit.
  if (expected.length !== layerOrder.length || !expected.every((id) => layerOrder.includes(id))) {
    return { kind: 'done' };
  }
  return expected.every((id, i) => id === layerOrder[i]) ? { kind: 'done' } : { kind: 'restore', order: expected };
}

function isLayerId(entry: LayerOrderEntry): entry is string {
  return typeof entry === 'string';
}
