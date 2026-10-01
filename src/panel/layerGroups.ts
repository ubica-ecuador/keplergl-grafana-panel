import { DEFAULT_LAYER_GROUPS } from '@kepler.gl/constants';

/** One of kepler's "Map Layers" groups: a slug, a filter over style layers and the switch's defaults. */
export type LayerGroup = (typeof DEFAULT_LAYER_GROUPS)[number];

/** What a group's filter sees of a layer in a style document. */
export interface StyleLayer {
  id: string;
  type?: string;
  'source-layer'?: string;
}

/**
 * A kepler group whose filter ignores case.
 *
 * kepler's filters look for Mapbox's lower-case ids (`water`, `road-label`),
 * so a style that writes `Water` — MapTiler v4 does — matches none and gets no
 * switches. Lower-casing the id before kepler's own filter reads it keeps
 * kepler's regular expressions as the single source, rather than copies of
 * them that drift.
 */
export function caseInsensitive(group: LayerGroup): LayerGroup {
  return {
    ...group,
    filter: (layer: StyleLayer) =>
      Boolean(
        group.filter({ ...layer, id: String(layer.id ?? '').toLowerCase(), type: layer.type?.toLowerCase() } as never)
      ),
  } as LayerGroup;
}

/**
 * The groups every vector base map is registered with. kepler draws a switch
 * for each group an entry lists.
 */
export const STYLE_LAYER_GROUPS: LayerGroup[] = DEFAULT_LAYER_GROUPS.map(caseInsensitive);

/**
 * The two groups the satellite overlays answer to: their roads and labels are
 * tile services of their own, and nothing else in those styles can be hidden.
 */
export const SATELLITE_LAYER_GROUPS: LayerGroup[] = STYLE_LAYER_GROUPS.filter(
  (group) => group.slug === 'label' || group.slug === 'road'
);

/** The slugs of the groups a style layer falls into. */
export function slugsMatching(groups: readonly LayerGroup[], layer: StyleLayer): string[] {
  return groups.filter((group) => Boolean(group.filter(layer as never))).map((group) => group.slug);
}
