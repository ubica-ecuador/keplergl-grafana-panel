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

/** A point of interest in the OpenMapTiles schema: a symbol of the `poi` source layer. */
export function isPointOfInterest(layer: StyleLayer): boolean {
  return layer.type?.toLowerCase() === 'symbol' && layer['source-layer']?.toLowerCase() === 'poi';
}

/**
 * A switch kepler does not have: shops, stations, hospitals… which kepler files
 * under its labels. Named through `mapLayers.poi` in `localeMessages.ts`.
 */
export const POI_LAYER_GROUP = {
  slug: 'poi',
  filter: (layer: StyleLayer) => isPointOfInterest(layer),
  defaultVisibility: true,
  isVisibilityToggleAvailable: true,
  isMoveToTopAvailable: true,
  isColorPickerAvailable: false,
} as LayerGroup;

/** kepler's label group catches every symbol; points of interest have their own switch. */
const withoutPointsOfInterest = (group: LayerGroup): LayerGroup =>
  ({
    ...group,
    filter: (layer: StyleLayer) => Boolean(group.filter(layer as never)) && !isPointOfInterest(layer),
  }) as LayerGroup;

/**
 * The groups every vector base map is registered with: kepler's, ignoring
 * case, with points of interest right after labels. kepler draws a switch for
 * each group an entry lists.
 */
export const STYLE_LAYER_GROUPS: LayerGroup[] = DEFAULT_LAYER_GROUPS.map(caseInsensitive).flatMap((group) =>
  group.slug === 'label' ? [withoutPointsOfInterest(group), POI_LAYER_GROUP] : [group]
);

/**
 * The two groups the satellite overlays answer to: their roads and labels are
 * tile services of their own, and nothing else in those styles can be hidden.
 */
export const SATELLITE_LAYER_GROUPS: LayerGroup[] = STYLE_LAYER_GROUPS.filter(
  (group) => group.slug === 'label' || group.slug === 'road'
);

/**
 * The groups with at least one layer in `style`. kepler draws a switch for
 * every group an entry lists, and one that matches nothing does nothing.
 * Without a `layers` array there is nothing to judge by, so all stay.
 */
export function layerGroupsIn(groups: readonly LayerGroup[], style: unknown): LayerGroup[] {
  const layers = (style as { layers?: unknown } | null | undefined)?.layers;
  if (!Array.isArray(layers)) {
    return [...groups];
  }
  return groups.filter((group) => layers.some((layer) => Boolean(group.filter(layer as never))));
}

/** The slugs of the groups a style layer falls into. */
export function slugsMatching(groups: readonly LayerGroup[], layer: StyleLayer): string[] {
  return groups.filter((group) => Boolean(group.filter(layer as never))).map((group) => group.slug);
}
