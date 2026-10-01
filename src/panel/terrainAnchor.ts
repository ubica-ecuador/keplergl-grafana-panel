import { DraggableMarkersLayer } from './markersDeckLayer';

/**
 * Standing the markers and the symbols on the basemap's relief.
 *
 * kepler has no terrain: the relief basemaps get theirs from MapLibre, which
 * reads `terrain` from the style (`basemaps.ts`). deck.gl draws in a canvas of
 * its own above the map, on a plane at z = 0, and knows nothing of it. MapLibre
 * aims its camera at the ground under the centre of the view; deck aims at
 * z = 0. Under a pitched camera the two agree only where the ground is as high
 * as at the centre: a point on a hill above it is drawn lower than the hill —
 * inside it — and one in a valley below it floats, and both slide as the map
 * pans. Measured over Cuenca (relief ×1.5, centre at 3807 m, pitch 60): a point
 * 233 m above the centre was drawn 29 px below where MapLibre has the ground.
 *
 * The fix is the one deck applies itself when it draws inside a MapLibre map
 * with terrain (`@deck.gl/mapbox`'s `getViewPropsFromMap`): the camera is
 * raised by the centre's elevation, and each point is drawn at the elevation of
 * the ground under it. Here the camera is kepler's, so the centre's elevation
 * goes into the layer instead, as a model matrix lowering it by that much — a
 * uniform, so a pan costs nothing per point. The points' own elevations are an
 * attribute, worked out again only when MapLibre loads more relief.
 *
 * Only the markers and the symbols are lifted. They are pins and signs that
 * stand on a spot, where being a few metres under the ground buries them; the
 * rest of kepler's layers stay on z = 0 as they always have.
 */

/** What the panel knows about the relief under one map, at one render. */
export interface TerrainAnchor {
  /** Elevation of the ground under the centre of the view, in metres, exaggeration included. */
  centre: number;
  /** Changes whenever MapLibre has more relief loaded, so the points' elevations are read again. */
  version: number;
  /** Elevation of the ground at a point, in metres, exaggeration included; 0 where there is none. */
  elevationAt(lng: number, lat: number): number;
}

/** The kepler layer types whose deck layers stand on the relief. */
export const ANCHORED_TYPES: ReadonlySet<string> = new Set(['markers', 'symbol']);

/** Column-major, as deck reads it: the identity, with z lowered by the centre's elevation. */
export function terrainModelMatrix(centre: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -centre, 1];
}

/** An elevation that is a number, or 0: MapLibre answers null with no terrain and 0 off its tiles. */
function metres(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * MapLibre's elevation lookup, remembered per point until the relief changes.
 *
 * deck reads a position once per point per attribute update, and the symbols
 * draw their positions up to four times (shadow, outline, symbol, label). The
 * cache is the lookup's own, so a new `version` is a new lookup and a new cache.
 */
export function cachedElevation(
  query: (lngLat: [number, number]) => number | null | undefined
): TerrainAnchor['elevationAt'] {
  const seen = new Map<string, number>();
  return (lng, lat) => {
    const key = `${lng},${lat}`;
    let value = seen.get(key);
    if (value === undefined) {
      value = metres(query([lng, lat]));
      seen.set(key, value);
    }
    return value;
  };
}

/** Elevation of the ground under the centre of the view; 0 when it cannot be read. */
export function centreElevation(
  query: (lngLat: [number, number]) => number | null | undefined,
  lng: unknown,
  lat: unknown
): number {
  return typeof lng === 'number' && typeof lat === 'number' ? metres(query([lng, lat])) : 0;
}

interface DeckLayerLike {
  id: string;
  props: Record<string, unknown> & { updateTriggers?: Record<string, unknown> };
  clone(props: Record<string, unknown>): DeckLayerLike;
}

function isDeckLayer(layer: unknown): layer is DeckLayerLike {
  return Boolean(
    layer && typeof (layer as DeckLayerLike).clone === 'function' && typeof (layer as DeckLayerLike).id === 'string'
  );
}

/**
 * The kepler layer a deck layer was drawn for, by id: kepler's own and ours
 * name theirs after the kepler layer (`<id>-symbol`, `<id>-markers`,
 * `<id>-label-…`). The longest id that prefixes it wins, so `sym-2-symbol`
 * belongs to `sym-2` and not to `sym`.
 */
function ownerOf(deckId: string, keplerIds: string[]): string | null {
  let owner: string | null = null;
  for (const id of keplerIds) {
    if ((deckId === id || deckId.startsWith(`${id}-`)) && (!owner || id.length > owner.length)) {
      owner = id;
    }
  }
  return owner;
}

/** The deck layer standing on the relief; the same layer when it has no position to lift. */
function anchored(layer: DeckLayerLike, anchor: TerrainAnchor): DeckLayerLike {
  const modelMatrix = terrainModelMatrix(anchor.centre);
  // The markers read their positions inside, and lift them there.
  if (layer instanceof DraggableMarkersLayer) {
    return layer.clone({ modelMatrix, terrain: anchor });
  }
  const getPosition = layer.props.getPosition;
  if (typeof getPosition !== 'function') {
    return layer;
  }
  const { elevationAt, version } = anchor;
  const triggers = layer.props.updateTriggers ?? {};
  return layer.clone({
    modelMatrix,
    // A height the row already has — the symbol layer's altitude column — is
    // kept, as a height above the ground.
    getPosition: (row: unknown, info: unknown) => {
      const [lng, lat, z] = (getPosition as (row: unknown, info: unknown) => number[])(row, info);
      return [lng, lat, (Number.isFinite(z) ? z : 0) + elevationAt(lng, lat)];
    },
    // deck never compares accessor functions: only a new trigger reads the
    // positions again.
    updateTriggers: { ...triggers, getPosition: { was: triggers.getPosition ?? null, terrain: version } },
  });
}

/**
 * kepler's deck layers, with those of its markers and symbol layers standing on
 * the relief; the same array when there is no relief or nothing to stand on it.
 */
export function anchorToTerrain(
  layers: unknown[],
  keplerLayers: Array<{ id?: string; type?: string | null }>,
  anchor: TerrainAnchor | null
): unknown[] {
  if (!anchor) {
    return layers;
  }
  const allIds = keplerLayers.map((layer) => layer.id).filter((id): id is string => typeof id === 'string');
  const anchoredIds = new Set(
    keplerLayers.filter((layer) => layer.id && ANCHORED_TYPES.has(layer.type ?? '')).map((layer) => layer.id as string)
  );
  if (anchoredIds.size === 0) {
    return layers;
  }
  let changed = false;
  const result = layers.map((layer) => {
    if (!isDeckLayer(layer)) {
      return layer;
    }
    const owner = ownerOf(layer.id, allIds);
    if (!owner || !anchoredIds.has(owner)) {
      return layer;
    }
    const lifted = anchored(layer, anchor);
    changed ||= lifted !== layer;
    return lifted;
  });
  return changed ? result : layers;
}
