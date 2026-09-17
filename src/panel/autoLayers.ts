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
 * Three collisions, for three different reasons.
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
 *
 * Since 3.3.0-alpha.12 the same grid also gets kepler's own **Flow Field**,
 * created for any dataset with columns named `u` and `v` beside coordinates.
 * That is not a wrong guess but a second copy of the panel's layer, with a clock
 * of its own instead of the dashboard's: two sets of streamlines over one grid.
 * It stays available in kepler's layer menu for anyone who picks it by hand.
 *
 * A symbol layer collides with the same guessed Point layer, for the same
 * reason: the coordinates are real, but a plain dot says nothing about the
 * bearing the symbol layer turns by.
 */
const SUPERSEDES: Record<string, string[]> = {
  trip: ['trip'],
  flowfield: ['point', 'flowField'],
  symbol: ['point'],
};

export function supersededLayerIds(layers: LayerLike[], added: AddedLayer): string[] {
  const guessed = SUPERSEDES[added.type];
  if (!guessed) {
    return [];
  }

  return layers
    .filter(
      (l) => l.id !== added.id && l.type !== undefined && guessed.includes(l.type) && l.config?.dataId === added.dataId
    )
    .map((l) => l.id);
}
