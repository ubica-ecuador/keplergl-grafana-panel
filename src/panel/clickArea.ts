/**
 * Turns a click on a map entity into a fixed-size search box, drawn as if the
 * user had drawn it.
 *
 * The box is not written to the dashboard variable from here. It is handed to
 * kepler as an editor feature — `setFeatures`, the very action kepler's own
 * editor dispatches when a drawing is finished (`editor-layer.js`) — and the
 * existing drawn-area pipeline (`readDrawnAreas` → `areaSync` → `useAreaSync`)
 * publishes it exactly as it publishes a hand drawing. So the variable keeps a
 * single author, whose state machine never has to learn about clicks, and the
 * box is visible on the map and deletable with kepler's own tool for free.
 *
 * Free of kepler and React so the geometry and the rules can be tested with
 * literal values.
 */

/**
 * Metres per degree of latitude on the IUGG mean sphere (R = 6 371 008.8 m).
 *
 * A sphere rather than the WGS84 ellipsoid: over a few kilometres the two
 * disagree by well under one per cent, which no search box can notice, and a
 * sphere keeps the conversion to one line.
 */
export const METRES_PER_DEGREE = (2 * Math.PI * 6_371_008.8) / 360;

/** The side length the user chose: a 6 km square around the clicked fire. */
export const DEFAULT_CLICK_AREA_METRES = 6000;

/** How close to a pole a box may reach before the longitude scaling stops meaning anything. */
const MAX_BOX_LATITUDE = 89;

export interface Position {
  lng: number;
  lat: number;
}

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

/**
 * A square of `sideMetres` on each side centred on `centre`, as a closed
 * GeoJSON ring, or null when no such box can be built.
 *
 * Constant in area, not in degrees: the latitude span is the side over the
 * length of a degree of latitude, and the longitude span is the same divided by
 * `cos(lat)`, because a degree of longitude shrinks towards the poles. The
 * user's own example box, about 0.0545° wide, is 6 km at the equator but only
 * 4.7 km at 39° N; this one is 6 km at both.
 *
 * Its east and west edges are meridians, so strictly the north edge of a box in
 * the northern hemisphere is a hair shorter than the south one — 0.3 m on 6 km
 * at 39° N. The width is exact along the box's middle parallel.
 *
 * Null for a centre that is not a finite position on the globe, a side that is
 * not a positive number, or a box that would reach within a degree of a pole,
 * where `cos(lat)` heads to zero and the longitude span to infinity.
 */
export function squareAround(centre: Position, sideMetres: number): PolygonGeometry | null {
  const { lng, lat } = centre;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(sideMetres) || sideMetres <= 0) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  const halfLat = sideMetres / 2 / METRES_PER_DEGREE;
  if (Math.abs(lat) + halfLat > MAX_BOX_LATITUDE) {
    return null;
  }
  const halfLng = halfLat / Math.cos((lat * Math.PI) / 180);

  const west = lng - halfLng;
  const east = lng + halfLng;
  const south = lat - halfLat;
  const north = lat + halfLat;

  // Same winding and starting corner as the user's example: north-west, then
  // down the west edge, across the south, up the east, and closed.
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, north],
        [west, south],
        [east, south],
        [east, north],
        [west, north],
      ],
    ],
  };
}

/**
 * Where the click landed, as far as this feature is concerned.
 *
 * `unresolved` is the one to keep apart from `empty`: a click that hit an
 * entity the panel could not place must not look like a click on bare map
 * (commit `5fdd463` lost an afternoon to exactly that), so it carries enough to
 * say which layer and why.
 */
export type ClickedPosition =
  | { kind: 'none' }
  | { kind: 'empty' }
  | { kind: 'position'; position: Position; layerId: string; layerType?: string }
  | { kind: 'unresolved'; layerId: string; layerType?: string; reason: string };

/** A figure kepler is holding, narrowed to what the rules read. */
export interface Figure {
  id: string;
  /** Set on polygon filters: the figure lives in a filter, not in the editor. */
  filterId?: string;
}

export type ClickAreaDecision =
  | { action: 'none' }
  | { action: 'warn'; message: string }
  | { action: 'place'; square: PolygonGeometry; replace: Figure[] };

/**
 * What a click should do to the drawn area.
 *
 * Only a click that resolved to a position places a box, and the box replaces
 * every figure already on the map — drawn or clicked, in the editor or already
 * a polygon filter — so the most recent intent is the only one left. A click on
 * bare map (`empty`) and no click state at all (`none`: a data refresh, the
 * draw toolbar owning the click) change nothing.
 */
export function decideClickArea({
  clicked,
  sideMetres,
  figures,
}: {
  clicked: ClickedPosition;
  sideMetres: number;
  figures: Figure[];
}): ClickAreaDecision {
  if (clicked.kind === 'none' || clicked.kind === 'empty') {
    return { action: 'none' };
  }
  if (clicked.kind === 'unresolved') {
    return {
      action: 'warn',
      message: `click on layer ${describe(clicked)} has no position to put a box around: ${clicked.reason}`,
    };
  }
  const square = squareAround(clicked.position, sideMetres);
  if (!square) {
    const { lng, lat } = clicked.position;
    return {
      action: 'warn',
      message: `click on layer ${describe(clicked)} at ${lng}, ${lat} cannot take a ${sideMetres} m box`,
    };
  }
  return { action: 'place', square, replace: figures };
}

/**
 * Whether the box a click placed should go, because the user has since drawn
 * something of their own.
 *
 * When the box was placed it was the only figure on the map, so any other
 * figure alongside it is a newer drawing. The drawn-area pipeline already
 * publishes that drawing — the newest change wins there — and this removes the
 * stale box so the map shows one figure, the one being searched. A box the user
 * has merely reshaped keeps its id and stays.
 */
export function isSquareSuperseded({ squareId, figures }: { squareId: string | null; figures: Figure[] }): boolean {
  if (squareId === null || !figures.some((figure) => figure.id === squareId)) {
    return false;
  }
  return figures.some((figure) => figure.id !== squareId);
}

function describe(clicked: { layerId: string; layerType?: string }): string {
  return clicked.layerType ? `${clicked.layerId} (${clicked.layerType})` : clicked.layerId;
}
