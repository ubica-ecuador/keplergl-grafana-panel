/**
 * Where a 3D tileset sits in z, and how to move it.
 *
 * A 3D Tiles tileset states its geometry at its **real altitude above the
 * ellipsoid**. The panel's world has no such thing: deck.gl draws on a flat
 * plane at z = 0 and does not drape onto terrain, so a mesh surveyed at an
 * elevation of 300 m is drawn floating 300 m in the air.
 *
 * That is not merely a cosmetic offset — it makes the layer **disappear**, with
 * no error anywhere. Measured on the AGI HQ mesh (Exton, PA; its base sits at
 * 297 m): deck selects 24-33 tiles at zoom ≤ 17 with the camera at nadir, and
 * **zero** as soon as the zoom reaches 18 *or* the pitch reaches 60 — the mesh
 * falls outside the frustum once the camera gets close to, or tilts under, it.
 * A user sees a layer in the list, no error in the console, and nothing on the
 * map. Bringing the base down to z = 0 restored 83 tiles at the same camera.
 *
 * **Why the tileset's own matrix and not the sublayers'.** deck's `Tile3DLayer`
 * builds one sublayer per loaded tile, and shifting those would move what is
 * drawn while leaving the traversal to cull exactly as before — the pictures
 * move, the missing ones stay missing. `Tileset3D` takes a `modelMatrix` that
 * is the **parent transform of the root** (`@loaders.gl/tiles`,
 * `tile-3d.js`: `parentTransform = parent ? parent.computedTransform :
 * this.tileset.modelMatrix`), so it feeds the bounding volumes the culling
 * reads. One matrix fixes both.
 *
 * Everything here is arithmetic on plain numbers: the layer that calls it lives
 * in `tile3dAltitudeLayer.ts`.
 */

/** A tile of a loaded `Tileset3D`, as far as the search for the ground reads it. */
export interface TileLike {
  header?: {
    boundingVolume?: Record<string, ArrayLike<number>>;
    /** Declared by the tileset: loaders.gl's own `Tile3D.transform` is an identity when there is none. */
    transform?: ArrayLike<number> | null;
    transformMatrix?: ArrayLike<number> | null;
    /** A `.json` here is a nested tileset, whose tiles arrive only once it has loaded. */
    contentUrl?: string | null;
  } | null;
  children?: readonly TileLike[] | null;
}

/** The parts of a loaded `Tileset3D` this module reads. */
export interface TilesetLike {
  /** math.gl `Matrix4` — an `Array` subclass, column-major, with a `clone`. */
  modelMatrix?: (ArrayLike<number> & { clone(): ArrayLike<number> }) | null;
  /** `[longitude, latitude, altitude]` of the root bounding volume's centre. */
  cartographicCenter?: ArrayLike<number> | null;
  root?: (TileLike & { transform?: ArrayLike<number> | null }) | null;
  /**
   * The trees Tileset3D actually traverses, one per viewport id. `root` is
   * built once and never traversed, so nothing below it ever loads.
   */
  roots?: Record<string, TileLike | null | undefined> | null;
  /** Tileset3D's own: nothing asked for is still loading. */
  isLoaded?(): boolean;
}

type Vec3 = [number, number, number];

/** Straight up, for a tileset that is not georeferenced onto the globe. */
const STRAIGHT_UP: [number, number, number] = [0, 0, 1];

/** WGS 84's equatorial radius, in metres: enough to turn a region's angles into a size. */
const EARTH_RADIUS = 6_378_137;

/**
 * A box or sphere whose centre lies this far from the centre of the Earth is
 * written in ECEF, on the globe, rather than in metres round its own origin.
 * The Earth's surface is at least 6 357 km from its centre.
 */
const ON_THE_GLOBE = 6_000_000;

/**
 * How far a tileset may spread from its centre, in metres, and still sit on one
 * ground height. A city is a few kilometres; a country or the whole world is
 * not one height, and has no one "up" either.
 */
const MAX_GROUNDED_HALF_EXTENT = 500_000;

/** The ellipsoid's upward normal at a longitude and latitude in radians. */
function normalAt(longitude: number, latitude: number): Vec3 {
  return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
}

/** Up, at a longitude and latitude in degrees: where a tileset round the whole world is lowered along. */
export function upAt(longitude: number, latitude: number): Vec3 {
  return normalAt((longitude * Math.PI) / 180, (latitude * Math.PI) / 180);
}

/** An identity matrix says nothing about where up is. loaders.gl hands one to every tile without a transform. */
function isIdentity(matrix: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) {
    if (Math.abs((matrix[i] ?? Number.NaN) - (i % 5 === 0 ? 1 : 0)) > 1e-12) {
      return false;
    }
  }
  return true;
}

/** A region's `[west, east]`, with east unwrapped past the antimeridian so that east ≥ west. */
function regionLongitudes(region: ArrayLike<number>): [number, number] {
  return [region[0], region[2] < region[0] ? region[2] + 2 * Math.PI : region[2]];
}

/** How far a bounding volume reaches from its centre, in metres, or null when it says nothing about it. */
function halfExtent(boundingVolume: Record<string, ArrayLike<number>> | undefined): number | null {
  const region = boundingVolume?.region;
  if (region && region.length >= 6) {
    const [west, east] = regionLongitudes(region);
    const latitude = (region[1] + region[3]) / 2;
    const halfWidth = ((east - west) / 2) * EARTH_RADIUS * Math.cos(latitude);
    const halfHeight = ((region[3] - region[1]) / 2) * EARTH_RADIUS;
    return Math.max(halfWidth, halfHeight);
  }
  const box = boundingVolume?.box;
  if (box && box.length >= 12) {
    return Math.max(
      Math.hypot(box[3], box[4], box[5]),
      Math.hypot(box[6], box[7], box[8]),
      Math.hypot(box[9], box[10], box[11])
    );
  }
  const sphere = boundingVolume?.sphere;
  if (sphere && sphere.length >= 4) {
    return sphere[3];
  }
  return null;
}

/**
 * Whether the tileset spreads too far for one ground height: a country, or the
 * whole world.
 *
 * Google's Photorealistic 3D Tiles and Cesium OSM Buildings are both the whole
 * world. Google's root is a cube centred on the centre of the Earth, so the
 * "base" worked out from it lies thousands of kilometres underground, and
 * grounding it shoved the globe out of view: not one tile was ever asked for.
 * OSM Buildings' root is a region round the whole world, and no one direction
 * is up on all of it.
 */
export function spansTooWide(tileset: TilesetLike | null | undefined): boolean {
  const extent = halfExtent(tileset?.root?.header?.boundingVolume);
  return extent !== null && extent > MAX_GROUNDED_HALF_EXTENT;
}

/**
 * The direction the tileset is moved along: up, where it stands.
 *
 * The root transform's up when there is one ({@link localUp}). A tileset with
 * no transform can still be on the globe: ion's tiler writes buildings as
 * regions, and a box can be written straight in ECEF. Up there is the
 * ellipsoid's normal at its centre. Only a tileset in metres round its own
 * origin keeps straight up: for the others, straight up is the Earth's axis,
 * which near the equator is horizontal and slid Cuenca's buildings north
 * instead of down.
 */
export function tilesetUp(tileset: TilesetLike | null | undefined): Vec3 {
  const transform = tileset?.root?.transform;
  if (transform && transform.length >= 11 && !isIdentity(transform)) {
    return localUp(transform);
  }
  const boundingVolume = tileset?.root?.header?.boundingVolume;
  const region = boundingVolume?.region;
  if (region && region.length >= 6) {
    const [west, east] = regionLongitudes(region);
    return normalAt((west + east) / 2, (region[1] + region[3]) / 2);
  }
  const centre = boundingVolume?.box ?? boundingVolume?.sphere;
  const cartographic = tileset?.cartographicCenter;
  if (
    centre &&
    centre.length >= 3 &&
    Math.hypot(centre[0], centre[1], centre[2]) > ON_THE_GLOBE &&
    cartographic &&
    Number.isFinite(cartographic[0]) &&
    Number.isFinite(cartographic[1])
  ) {
    return normalAt((cartographic[0] * Math.PI) / 180, (cartographic[1] * Math.PI) / 180);
  }
  return STRAIGHT_UP;
}

/**
 * The site's local vertical, in the frame the tileset's transforms live in.
 *
 * A georeferenced tileset carries an ECEF transform whose third column is the
 * local up at that point on the globe — the same column GeoLibre reads for its
 * own altitude control. Reading it beats deriving one from the latitude and
 * longitude: it is the very basis the tile geometry was built against.
 *
 * Normalised rather than trusted, because a transform is free to carry a scale,
 * and an un-normalised axis turns a 300 m offset into 900 m — an error that
 * reads as a wrong number rather than a wrong axis, and so costs an afternoon.
 */
export function localUp(transform: ArrayLike<number> | null | undefined): [number, number, number] {
  if (!transform || transform.length < 11) {
    return STRAIGHT_UP;
  }
  const [x, y, z] = [transform[8], transform[9], transform[10]];
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) {
    return STRAIGHT_UP;
  }
  return [x / length, y / length, z / length];
}

/*
 * The ground under the centre of the view, for a tileset round the whole world.
 *
 * One height cannot ground Google's globe or OSM Buildings: Cuenca stands at
 * 2 550 m and Guayaquil at sea level. So such a tileset is lowered by the ground
 * height under the centre of the view, along the vertical there, and again
 * whenever the view moves somewhere else. deck's world is flat at z = 0 and its
 * camera, close up, is only a kilometre or two above it: left at its real
 * altitude, Cuenca's mesh sat above the camera and nothing was drawn.
 *
 * The height comes from the tileset itself: the deepest tile already known
 * whose volume the vertical under the centre passes through, and the height at
 * which it enters it. A tile's header arrives with its parent's JSON, before its
 * own content, so the tree often reaches deeper than what has been drawn.
 */

/** WGS 84's first eccentricity squared. */
const WGS84_E2 = 6.69437999014e-3;

/** The column searched under the centre of the view: below the deepest trench's floor to above every summit. */
const COLUMN_BOTTOM = -12_000;
const COLUMN_TOP = 9_000;

/** A tile wider than this cannot say where the ground is under one point: its volume spans valleys and coasts. */
const MAX_SAMPLE_HALF_EXTENT = 100_000;

/** Above every summit there is: no search goes past it, and a camera above it sees the whole mesh anyway. */
const SEARCH_CEILING = 9_000;

/** How far the search lowers the tileset each time it finds nothing, in metres. */
const SEARCH_STEP = 1_500;

/** WGS 84, geodetic (radians, metres) to ECEF. */
function ecef(longitude: number, latitude: number, height: number): Vec3 {
  const n = EARTH_RADIUS / Math.sqrt(1 - WGS84_E2 * Math.sin(latitude) ** 2);
  return [
    (n + height) * Math.cos(latitude) * Math.cos(longitude),
    (n + height) * Math.cos(latitude) * Math.sin(longitude),
    (n * (1 - WGS84_E2) + height) * Math.sin(latitude),
  ];
}

/** What a tile says about the ground under a point. */
export interface GroundSample {
  /** Where the vertical under the point enters the tile: nothing in it lies lower. */
  height: number;
  /** Where the vertical leaves it: nothing in it lies higher. */
  top: number;
  /** Whether nothing lies below it in the tree, now or once a nested tileset loads. */
  leaf: boolean;
}

/** What one tile's volume says about the column, before the tree has had its say. */
interface VolumeSample {
  height: number;
  top: number;
  halfExtent: number;
}

/** The vertical under a point, from {@link COLUMN_BOTTOM} to {@link COLUMN_TOP}. */
interface Column {
  longitude: number;
  latitude: number;
  bottom: Vec3;
  along: Vec3;
}

function columnAt(longitude: number, latitude: number): Column {
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const bottom = ecef(lon, lat, COLUMN_BOTTOM);
  const top = ecef(lon, lat, COLUMN_TOP);
  return { longitude: lon, latitude: lat, bottom, along: [top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]] };
}

/** Where along the column, from 0 at its bottom to 1 at its top, it enters and leaves a box; null when it misses it. */
function throughBox(column: Column, box: ArrayLike<number>): [number, number] | null {
  let enter = 0;
  let leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const u = [box[3 + axis * 3], box[4 + axis * 3], box[5 + axis * 3]];
    const length2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    if (!(length2 > 0)) {
      return null;
    }
    // The column's position along this half-axis, in half-axis lengths: inside is [-1, 1].
    const start =
      ((column.bottom[0] - box[0]) * u[0] + (column.bottom[1] - box[1]) * u[1] + (column.bottom[2] - box[2]) * u[2]) /
      length2;
    const rate = (column.along[0] * u[0] + column.along[1] * u[1] + column.along[2] * u[2]) / length2;
    if (Math.abs(rate) < 1e-15) {
      if (Math.abs(start) > 1) {
        return null;
      }
      continue;
    }
    const a = (-1 - start) / rate;
    const b = (1 - start) / rate;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave ? [enter, leave] : null;
}

/** What one tile's volume says about the ground under the column, or null when the column misses it. */
function sampleOf(column: Column, volume: Record<string, ArrayLike<number>> | undefined): VolumeSample | null {
  const region = volume?.region;
  if (region && region.length >= 6) {
    const [west, east] = regionLongitudes(region);
    const longitude = column.longitude < west ? column.longitude + 2 * Math.PI : column.longitude;
    if (longitude > east || column.latitude < region[1] || column.latitude > region[3]) {
      return null;
    }
    return { height: region[4], top: region[5], halfExtent: halfExtent(volume) ?? Infinity };
  }
  const box = volume?.box;
  if (box && box.length >= 12) {
    const through = throughBox(column, box);
    const heightAt = (along: number) => COLUMN_BOTTOM + along * (COLUMN_TOP - COLUMN_BOTTOM);
    return through === null
      ? null
      : { height: heightAt(through[0]), top: heightAt(through[1]), halfExtent: halfExtent(volume) ?? Infinity };
  }
  return null;
}

/**
 * The ground under a point, from the deepest tile known to hold it and small
 * enough to tell; null when no such tile is known yet.
 *
 * Read from the tree Tileset3D traverses for the viewport (`roots`), which is
 * the one that grows as tiles load; `root` only when no viewport id is given.
 *
 * Stops at a tile with a transform of its own: the heights of what lies below
 * it cannot be read without composing it, and neither Google's tree nor OSM
 * Buildings' has one.
 */
export function groundUnder(
  tileset: Pick<TilesetLike, 'root' | 'roots'> | null | undefined,
  longitude: number,
  latitude: number,
  viewportId?: string
): GroundSample | null {
  const column = columnAt(longitude, latitude);
  let best: GroundSample | null = null;
  let tile: TileLike | null | undefined = viewportId === undefined ? tileset?.root : tileset?.roots?.[viewportId];
  while (tile && !(tile.header?.transform ?? tile.header?.transformMatrix)) {
    const sample = sampleOf(column, tile.header?.boundingVolume);
    if (!sample) {
      break;
    }
    const nestedTileset = /\.json(\?|#|$)/i.test(tile.header?.contentUrl ?? '');
    if (sample.halfExtent <= MAX_SAMPLE_HALF_EXTENT) {
      best = { height: sample.height, top: sample.top, leaf: !tile.children?.length && !nestedTileset };
    }
    tile = tile.children?.find((child) => sampleOf(column, child.header?.boundingVolume) !== null);
  }
  return best;
}

/**
 * The ground to lower a tileset round the whole world by, given what its tree
 * says under the centre of the view.
 *
 * A sample is taken as it is when the camera can see into its tile once the
 * tileset is lowered by it — the tile's top then ends below the camera, so
 * whatever lies in it gets asked for and a better sample follows — and when
 * it is a leaf, below which there is nothing more to find. From above
 * {@link SEARCH_CEILING} any sample will do: the whole mesh is below the camera.
 *
 * Otherwise the ground has to be searched for: over Cuenca the mesh sits above
 * a camera a kilometre and a half up, so the tiles that would say where the
 * ground is are never asked for. Once everything asked for has loaded, the
 * tileset is lowered another {@link SEARCH_STEP} and looked at again, until a
 * sample will do or the search reaches {@link SEARCH_CEILING}. While tiles are
 * still loading the last ground holds.
 *
 * `previous` is the ground last applied, null before the first.
 */
export function nextGround(
  sample: GroundSample | null,
  view: { cameraHeight: number },
  settled: boolean,
  previous: number | null
): { ground: number; searched: boolean } {
  const highUp = !(view.cameraHeight < SEARCH_CEILING);
  if (sample && (sample.leaf || highUp || sample.top - sample.height < view.cameraHeight)) {
    return { ground: sample.height, searched: false };
  }
  if (highUp) {
    return { ground: previous ?? 0, searched: false };
  }
  const known = Math.max(previous ?? -Infinity, sample?.height ?? -Infinity);
  const held = Number.isFinite(known) ? known : 0;
  if (!settled || held >= SEARCH_CEILING) {
    return { ground: held, searched: false };
  }
  return { ground: Math.min(held + SEARCH_STEP, SEARCH_CEILING), searched: true };
}

/** The half-height of a bounding volume, in metres, or 0 when it has none. */
function halfHeight(boundingVolume: Record<string, ArrayLike<number>> | undefined): number {
  const box = boundingVolume?.box;
  if (box && box.length >= 12) {
    // `[centre(3), xHalfAxis(3), yHalfAxis(3), zHalfAxis(3)]`: the last vector's
    // length is the half-extent along the box's own vertical.
    return Math.hypot(box[9], box[10], box[11]);
  }
  const sphere = boundingVolume?.sphere;
  if (sphere && sphere.length >= 4) {
    return sphere[3];
  }
  return 0;
}

/**
 * How far above the panel's ground plane the tileset's lowest point sits.
 *
 * The **base**, not the centre: they differ by the half-height, which for a
 * building is most of a building. Anchoring on the centre sinks half the
 * geometry below the map — GeoLibre's hand-typed −300 for this same tileset is
 * a rounded version of the base, not of the centre.
 *
 * A `region` bounding volume is the easy case and the only one that needs no
 * arithmetic: it states its own minimum height above the ellipsoid.
 *
 * `null` when the tileset has not said enough to work it out, which is the
 * signal to leave it where it is rather than to guess — and for a tileset that
 * {@link spansTooWide spans too wide} to have one base at all.
 */
export function baseAltitude(tileset: TilesetLike | null | undefined): number | null {
  if (spansTooWide(tileset)) {
    return null;
  }
  const boundingVolume = tileset?.root?.header?.boundingVolume;

  const region = boundingVolume?.region;
  if (region && region.length >= 6 && Number.isFinite(region[4])) {
    return region[4];
  }

  const centre = tileset?.cartographicCenter;
  if (!centre || centre.length < 3 || !Number.isFinite(centre[2])) {
    return null;
  }
  return centre[2] - halfHeight(boundingVolume);
}

/** The knobs this feature adds to a 3D tile layer's `visConfig`. */
export interface AltitudeVisConfig {
  /** Bring the tileset's base down to the map's ground plane. Default: yes. */
  groundTileset?: unknown;
  /** A trim in metres, applied after the grounding. */
  altitudeOffset?: unknown;
}

/** A `visConfig` number, or 0 — a knob left blank must not move anything. */
function metres(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** The manual trim, in metres: what "Height adjustment" adds on top of any grounding. */
export function trimOf(visConfig: AltitudeVisConfig): number {
  return metres(visConfig.altitudeOffset);
}

/**
 * The offset to apply, in metres along the local vertical.
 *
 * Grounding is on by default, and that default is the whole point: a mesh added
 * through *Add Data → Tileset → 3D Tile* otherwise renders nothing at all at
 * any useful camera. For a tileset already surveyed near sea level the
 * correction is a metre or two, so switching it on by default costs the cases
 * that already worked almost nothing.
 *
 * The trim is added on top rather than replacing it, so a user nudging a mesh
 * by a few metres does not also have to work out its absolute altitude.
 *
 * A tileset that {@link spansTooWide spans too wide} has no one base and no one
 * "up", so this leaves it where it is. The layer grounds such a tileset at the
 * centre of the view instead ({@link groundUnder}, {@link nextGround}), where
 * it knows the view.
 */
export function altitudeOffsetFor(visConfig: AltitudeVisConfig, tileset: TilesetLike | null | undefined): number {
  if (spansTooWide(tileset)) {
    return 0;
  }
  const trim = metres(visConfig.altitudeOffset);
  if (visConfig.groundTileset === false) {
    return trim;
  }
  const base = baseAltitude(tileset);
  return base === null ? trim : trim - base;
}

/** How close two offsets have to be to count as the same, in metres. */
const EPSILON = 1e-6;

/**
 * Writes the offset into the tileset's model matrix.
 *
 * The translation is **replaced, never added to**: `renderLayer` runs on every
 * store change and its own output comes back as input, so accumulating would
 * walk the tileset off the planet a few hundred metres at a time. The same
 * reasoning as the time fragment in `wmsTimeLayer.ts`.
 *
 * Returns whether anything moved, which is what lets the caller force a fresh
 * traversal only when there is a reason to — the traversal is the expensive
 * half, and it already runs on every camera change.
 *
 * `up` defaults to {@link tilesetUp}; a tileset round the whole world is given
 * the vertical at the centre of the view instead ({@link upAt}), with a
 * `tolerance` in metres under which a move is not worth a traversal.
 */
export function applyAltitude(
  tileset: TilesetLike | null | undefined,
  offset: number,
  options: { up?: Vec3; tolerance?: number } = {}
): boolean {
  const matrix = tileset?.modelMatrix;
  if (!matrix || typeof matrix.clone !== 'function' || !Number.isFinite(offset)) {
    return false;
  }

  const up = options.up ?? tilesetUp(tileset);
  const wanted = [up[0] * offset, up[1] * offset, up[2] * offset];
  const distance = Math.hypot(wanted[0] - matrix[12], wanted[1] - matrix[13], wanted[2] - matrix[14]);
  if (distance < Math.max(options.tolerance ?? 0, EPSILON)) {
    return false;
  }

  // Cloned rather than written in place: math.gl matrices are handed around by
  // reference, and deck compares props by identity to decide what changed.
  const next = matrix.clone() as ArrayLike<number> & { clone(): ArrayLike<number> };
  const writable = next as unknown as number[];
  writable[12] = wanted[0];
  writable[13] = wanted[1];
  writable[14] = wanted[2];

  (tileset as { modelMatrix?: unknown }).modelMatrix = next;
  return true;
}
