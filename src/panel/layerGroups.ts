import { DEFAULT_LAYER_GROUPS, THREE_D_BUILDING_LAYER_GROUP_SLUG } from '@kepler.gl/constants';

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

const isExtrusion = (layer: StyleLayer) => layer.type?.toLowerCase() === 'fill-extrusion';

/**
 * "3D Building", pointed at the style's own extrusions.
 *
 * kepler's switch draws a deck.gl layer of Mapbox's buildings, which it builds
 * only when it has a Mapbox token (`layer-utils.js`); the free panel has none,
 * so the switch did nothing. Pointed at a style's `fill-extrusion` layers it
 * hides and shows those — and with no such layer the group is dropped
 * (`layerGroupsIn`). The colour picker paints only kepler's layer, so it is off.
 */
const styleExtrusions = (group: LayerGroup): LayerGroup =>
  ({
    ...group,
    filter: (layer: StyleLayer) => isExtrusion(layer),
    defaultVisibility: true,
    isColorPickerAvailable: false,
  }) as LayerGroup;

/** Flat footprints only, so the two building switches never hide each other's layers. */
const withoutExtrusions = (group: LayerGroup): LayerGroup =>
  ({
    ...group,
    filter: (layer: StyleLayer) => Boolean(group.filter(layer as never)) && !isExtrusion(layer),
  }) as LayerGroup;

/**
 * The groups every vector base map is registered with: kepler's, ignoring
 * case, with points of interest right after labels and 3D buildings that are
 * the style's own. kepler draws a switch for each group an entry lists;
 * `loadedLayerGroups.ts` keeps only the ones the document turns out to have.
 */
export const STYLE_LAYER_GROUPS: LayerGroup[] = DEFAULT_LAYER_GROUPS.map(caseInsensitive).flatMap((group) => {
  switch (group.slug) {
    case 'label':
      return [withoutPointsOfInterest(group), POI_LAYER_GROUP];
    case 'building':
      return [withoutExtrusions(group)];
    case THREE_D_BUILDING_LAYER_GROUP_SLUG:
      return [styleExtrusions(group)];
    default:
      return [group];
  }
});

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

type GroupStates = Record<string, boolean>;

/** The part of a parsed saved config {@link poiFollowsSavedLabel} reads. */
interface ConfigWithMapStyle {
  mapStyle?: { visibleLayerGroups?: GroupStates; topLayerGroups?: GroupStates };
}

/**
 * A parsed saved config whose switch states predate the Points of interest
 * group, with that group given the state labels had.
 *
 * kepler's label group caught every symbol, so a map saved with labels off hid
 * points of interest too, and labels on top drew them on top. Without this, the
 * missing `poi` would take its default and bring them back. Returns the config
 * it was given, by identity, when there is nothing to carry over.
 */
export function poiFollowsSavedLabel<C>(config: C): C {
  const mapStyle = (config as ConfigWithMapStyle | null | undefined)?.mapStyle;
  const carried = (states?: GroupStates) =>
    states && 'label' in states && !('poi' in states) ? { ...states, poi: states.label } : states;
  const visibleLayerGroups = carried(mapStyle?.visibleLayerGroups);
  const topLayerGroups = carried(mapStyle?.topLayerGroups);
  if (!mapStyle || (visibleLayerGroups === mapStyle.visibleLayerGroups && topLayerGroups === mapStyle.topLayerGroups)) {
    return config;
  }
  return {
    ...config,
    mapStyle: {
      ...mapStyle,
      ...(visibleLayerGroups && { visibleLayerGroups }),
      ...(topLayerGroups && { topLayerGroups }),
    },
  };
}
