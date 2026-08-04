/** The little kepler needs to know about a layer to compare it with ours. */
interface LayerLike {
  id: string;
  type?: string;
  config?: { dataId?: string };
}

/** The layer the panel added, and the dataset it belongs to. */
interface AddedLayer {
  id: string;
  type: string;
  dataId: string;
}

/**
 * Layers kepler guessed that the panel's own layer supersedes.
 *
 * Only trips can collide. kepler has no flow detection at all, but it does
 * build a default Trip layer whenever a dataset carries a column named `id`
 * next to coordinates and a timestamp — which `SELECT *` on a trajectory table
 * usually does. It then groups by that per-row id, turning every GPS ping into
 * a one-point trip, and the result sits in the layer list next to the layer the
 * panel built from the actual trip id.
 */
export function supersededTripLayerIds(layers: LayerLike[], added: AddedLayer): string[] {
  if (added.type !== 'trip') {
    return [];
  }

  return layers
    .filter((l) => l.id !== added.id && l.type === 'trip' && l.config?.dataId === added.dataId)
    .map((l) => l.id);
}
