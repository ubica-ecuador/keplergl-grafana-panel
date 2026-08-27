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
 * What kepler guesses that each of the panel's own layers supersedes.
 *
 * Two collisions, for two different reasons.
 *
 * kepler builds a default **Trip** layer whenever a dataset carries a column
 * named `id` next to coordinates and a timestamp — which `SELECT *` on a
 * trajectory table usually does. It then groups by that per-row id, turning
 * every GPS ping into a one-point trip, and the result sits in the layer list
 * next to the layer the panel built from the actual trip id.
 *
 * And it builds a **Point** layer from any pair of coordinates, which a velocity
 * grid is: a lattice of lat/lon samples. The dots are the grid, honestly drawn
 * and completely beside the point — what the query describes is the flow through
 * them, which is what the flow field layer draws.
 */
const SUPERSEDES: Record<string, string> = {
  trip: 'trip',
  flowfield: 'point',
};

export function supersededLayerIds(layers: LayerLike[], added: AddedLayer): string[] {
  const guessed = SUPERSEDES[added.type];
  if (!guessed) {
    return [];
  }

  return layers
    .filter((l) => l.id !== added.id && l.type === guessed && l.config?.dataId === added.dataId)
    .map((l) => l.id);
}
