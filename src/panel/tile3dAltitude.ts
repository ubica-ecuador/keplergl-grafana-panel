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
 * reads. One matrix fixes both — for the tiles still to load. Those already
 * loaded were placed once, when they loaded, and are moved with it
 * ({@link applyAltitude}).
 *
 * Everything here is arithmetic on plain numbers: the layer that calls it lives
 * in `tile3dAltitudeLayer.ts`.
 */

/**
 * What loaders.gl works out for a tile once its content has loaded
 * (`calculateTransformProps`, `@loaders.gl/tiles`), and deck draws it with for
 * as long as it stays loaded.
 */
export interface TileContentLike {
  /** The centre of the tile's bounding volume, in ECEF, when it loaded. */
  cartesianOrigin?: ArrayLike<number> | null;
  /** The tile's geometry to ECEF. */
  cartesianModelMatrix?: ArrayLike<number> | null;
  /** `cartesianOrigin` as `[longitude, latitude, height]`: the origin deck draws round. */
  cartographicOrigin?: ArrayLike<number> | null;
  /** The tile's geometry to metres east, north and up of `cartographicOrigin`. */
  cartographicModelMatrix?: ArrayLike<number> | null;
  /** loaders.gl's alias of `cartographicModelMatrix`, which is what deck reads; I3S sets one of its own. */
  modelMatrix?: unknown;
}

/** A tile of a loaded `Tileset3D`, as far as this module reads it. */
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
  /** Null until the tile's content has loaded. */
  content?: TileContentLike | null;
  parent?: TileLike | null;
  /** loaders.gl's: the tile's own transform, an identity when it declares none. */
  transform?: ArrayLike<number> | null;
  /** loaders.gl's: the tileset's model matrix times every transform down to this tile, as of the last traversal. */
  computedTransform?: ArrayLike<number> | null;
  /** The tileset the tile belongs to. */
  tileset?: Pick<TilesetLike, 'modelMatrix'> | null;
}

/** The parts of a loaded `Tileset3D` this module reads. */
export interface TilesetLike {
  /** math.gl `Matrix4` — an `Array` subclass, column-major, with a `clone`. */
  modelMatrix?: (ArrayLike<number> & { clone(): ArrayLike<number> }) | null;
  /** `[longitude, latitude, altitude]` of the root bounding volume's centre. */
  cartographicCenter?: ArrayLike<number> | null;
  root?: TileLike | null;
  /**
   * The trees Tileset3D actually traverses, one per viewport id. `root` is
   * built once and never traversed, so nothing below it ever loads.
   */
  roots?: Record<string, TileLike | null | undefined> | null;
  /** Tileset3D's own: the tiles it last selected, the ones deck draws. */
  tiles?: readonly TileLike[] | null;
  /** Tileset3D's own: nothing asked for is still loading. */
  isLoaded?(): boolean;
}

type Vec3 = [number, number, number];

/** How close two offsets have to be to count as the same, in metres. */
const EPSILON = 1e-6;

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

/** Whether a tile carries a transform that moves what lies under it: loaders.gl's own identity does not count. */
function hasOwnTransform(tile: TileLike | null | undefined): boolean {
  return [tile?.transform, tile?.header?.transform, tile?.header?.transformMatrix].some(
    (matrix) => Boolean(matrix) && !isIdentity(matrix!)
  );
}

/**
 * Whether the tileset is lowered by the ground under the centre of the view
 * ({@link groundUnder}, {@link nextGround}) rather than by one base.
 *
 * It spans too wide for one base, and the ground under the view can be read
 * off its tree: a root with no transform of its own, bounded by a region or a
 * box — Google's globe and Cesium OSM Buildings. A wide root under a transform,
 * or bounded by a sphere, cannot be read that way, and stays where it is.
 */
export function groundsUnderView(tileset: TilesetLike | null | undefined): boolean {
  if (!spansTooWide(tileset) || hasOwnTransform(tileset?.root)) {
    return false;
  }
  const volume = tileset?.root?.header?.boundingVolume;
  return Boolean((volume?.region && volume.region.length >= 6) || (volume?.box && volume.box.length >= 12));
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

/**
 * What the tree says about the ground under a point: a sample, or why there is none.
 *
 * - `unreadable`: there is no tree to read yet, or its root cannot be read
 *   (a transform of its own, or no region or box).
 * - `missed`: no tile under the point could tell, now or later — OSM Buildings
 *   over the sea, where there are no buildings to have tiles.
 * - `coarse`: only tiles too big to tell hold the point, and more of the tree
 *   is still to load under them. The one case a search can help.
 */
export type GroundReading = GroundSample | { none: 'unreadable' | 'missed' | 'coarse' };

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

/** A longitude in degrees, brought into [-180, 180): deck's can run past the antimeridian, a region's cannot. */
function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function columnAt(longitude: number, latitude: number): Column {
  const lon = (wrapLongitude(longitude) * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const bottom = ecef(lon, lat, COLUMN_BOTTOM);
  const top = ecef(lon, lat, COLUMN_TOP);
  return { longitude: lon, latitude: lat, bottom, along: [top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]] };
}

/**
 * A box's three half-axes, with one of no length replaced by the unit normal of
 * the other two: the box is then a slab of no thickness, which the column can
 * still pass through. Null when two or more have no length.
 */
function boxAxes(box: ArrayLike<number>): Array<{ axis: Vec3; flat: boolean }> | null {
  const axes: Vec3[] = [0, 1, 2].map((i) => [box[3 + i * 3], box[4 + i * 3], box[5 + i * 3]]);
  const flat = axes.map((u) => !(u[0] * u[0] + u[1] * u[1] + u[2] * u[2] > 0));
  const flatCount = flat.filter(Boolean).length;
  if (flatCount === 0) {
    return axes.map((axis) => ({ axis, flat: false }));
  }
  if (flatCount > 1) {
    return null;
  }
  const index = flat.indexOf(true);
  const [a, b] = axes.filter((_, i) => i !== index);
  const normal: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = Math.hypot(...normal);
  if (!(length > 0)) {
    return null;
  }
  return axes.map((axis, i) =>
    i === index
      ? { axis: [normal[0] / length, normal[1] / length, normal[2] / length], flat: true }
      : { axis, flat: false }
  );
}

/** Where along the column, from 0 at its bottom to 1 at its top, it enters and leaves a box; null when it misses it. */
function throughBox(column: Column, box: ArrayLike<number>): [number, number] | null {
  const axes = boxAxes(box);
  if (!axes) {
    return null;
  }
  let enter = 0;
  let leave = 1;
  for (const { axis: u, flat } of axes) {
    // The column's position along this half-axis, in half-axis lengths: inside
    // is [-1, 1]. Along a flat one, in metres from the slab: inside is 0.
    const length2 = flat ? 1 : u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const reach = flat ? 0 : 1;
    const start =
      ((column.bottom[0] - box[0]) * u[0] + (column.bottom[1] - box[1]) * u[1] + (column.bottom[2] - box[2]) * u[2]) /
      length2;
    const rate = (column.along[0] * u[0] + column.along[1] * u[1] + column.along[2] * u[2]) / length2;
    if (Math.abs(rate) < 1e-15) {
      if (Math.abs(start) > reach) {
        return null;
      }
      continue;
    }
    const a = (-reach - start) / rate;
    const b = (reach - start) / rate;
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

/** Whether a tile's content is a tileset of its own, whose tiles arrive only once it has loaded. */
function isNestedTileset(tile: TileLike): boolean {
  return /\.json(\?|#|$)/i.test(tile.header?.contentUrl ?? '');
}

/**
 * The ground under a point, from the deepest tile known to hold it and small
 * enough to tell — the lowest, of two as deep — or why there is none
 * ({@link GroundReading}).
 *
 * Every child the vertical passes through is looked under, not only the first:
 * siblings may overlap, and the first can stop short while the next reaches
 * the city.
 *
 * Read from the tree Tileset3D traverses for the viewport (`roots`), which is
 * the one that grows as tiles load; `root` only when no viewport id is given.
 *
 * Does not look under a tile with a transform of its own: the heights of what
 * lies below it cannot be read without composing it, and neither Google's
 * tree nor OSM Buildings' has one.
 */
export function groundUnder(
  tileset: Pick<TilesetLike, 'root' | 'roots'> | null | undefined,
  longitude: number,
  latitude: number,
  viewportId?: string
): GroundReading {
  const root = viewportId === undefined ? tileset?.root : tileset?.roots?.[viewportId];
  const volume = root?.header?.boundingVolume;
  if (!root || hasOwnTransform(root) || !((volume?.region?.length ?? 0) >= 6 || (volume?.box?.length ?? 0) >= 12)) {
    return { none: 'unreadable' };
  }

  const column = columnAt(longitude, latitude);
  let best: (GroundSample & { depth: number }) | null = null;
  let moreToCome = false;
  const stack: Array<{ tile: TileLike; depth: number }> = [{ tile: root, depth: 0 }];
  while (stack.length > 0) {
    const { tile, depth } = stack.pop()!;
    const sample = sampleOf(column, tile.header?.boundingVolume);
    if (!sample) {
      continue;
    }
    const children = tile.children ?? [];
    const nestedTileset = isNestedTileset(tile);
    if (sample.halfExtent <= MAX_SAMPLE_HALF_EXTENT) {
      if (!best || depth > best.depth || (depth === best.depth && sample.height < best.height)) {
        best = { height: sample.height, top: sample.top, leaf: children.length === 0 && !nestedTileset, depth };
      }
    } else if (children.length === 0 && nestedTileset) {
      moreToCome = true;
    }
    for (const child of children) {
      if (!hasOwnTransform(child)) {
        stack.push({ tile: child, depth: depth + 1 });
      }
    }
  }
  if (best) {
    return { height: best.height, top: best.top, leaf: best.leaf };
  }
  return { none: moreToCome ? 'coarse' : 'missed' };
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
 * Otherwise, when only tiles too big to tell are known there (or the one
 * sample reaches above the camera), the ground has to be searched for: over
 * Cuenca the mesh sits above a camera a kilometre and a half up, so the tiles
 * that would say where the ground is are never asked for. Once the last step
 * has {@link searchSettled settled}, the tileset is lowered another
 * {@link SEARCH_STEP} and looked at again, until a sample will do or the search
 * reaches {@link SEARCH_CEILING}. Until then the last ground holds.
 *
 * Where the tree cannot be read yet, or has nothing under the point, a search
 * would find nothing: the last ground holds, or none before the first.
 *
 * `previous` is the ground last settled on, null before the first.
 */
export function nextGround(
  reading: GroundReading,
  view: { cameraHeight: number },
  settled: boolean,
  previous: number | null
): { ground: number; searched: boolean } {
  const sample = 'height' in reading ? reading : null;
  const highUp = !(view.cameraHeight < SEARCH_CEILING);
  if (sample && (sample.leaf || highUp || sample.top - sample.height < view.cameraHeight)) {
    return { ground: sample.height, searched: false };
  }
  if (highUp || (!sample && 'none' in reading && reading.none !== 'coarse')) {
    return { ground: previous ?? 0, searched: false };
  }
  const known = Math.max(previous ?? -Infinity, sample?.height ?? -Infinity);
  const held = Number.isFinite(known) ? known : 0;
  if (!settled || held >= SEARCH_CEILING) {
    return { ground: held, searched: false };
  }
  return { ground: Math.min(held + SEARCH_STEP, SEARCH_CEILING), searched: true };
}

/** Traversals after a search step past which it counts as settled, whatever is still loading. */
const SETTLE_FRAMES = 20;

/** Milliseconds after a search step past which it counts as settled, whatever is still loading. */
const SETTLE_TIME = 3_000;

/**
 * Whether the last search step (or the start, before the first) has had its
 * effect: at least one traversal has completed since, and either everything
 * asked for has loaded, or {@link SETTLE_FRAMES} traversals or
 * {@link SETTLE_TIME} have gone by.
 *
 * Loaded alone is not enough to wait for: with the network throttled, or a
 * tileset as busy as Google's, something is always loading, and the search
 * would never take its next step.
 *
 * `frame` is deck's count of completed traversals, `stepFrame` and `stepTime`
 * those of the last step (or of the start); `now` is the time in the same
 * milliseconds, passed in so that the tests can choose it.
 */
export function searchSettled(state: {
  loaded: boolean;
  frame: number | null | undefined;
  stepFrame: number | null | undefined;
  now: number;
  stepTime: number | null | undefined;
}): boolean {
  const { loaded, frame, stepFrame, now, stepTime } = state;
  if (typeof frame !== 'number' || frame === stepFrame) {
    return false;
  }
  if (loaded || frame - (stepFrame ?? 0) >= SETTLE_FRAMES) {
    return true;
  }
  return typeof stepTime === 'number' && now - stepTime >= SETTLE_TIME;
}

/** Where a tileset round the whole world was, or is to be, put: the ground, the trim and the vertical. */
export interface Placement {
  ground: number;
  trim: number;
  up: Vec3;
}

/**
 * Whether a tileset round the whole world has to be moved from where it was
 * last put to where it now belongs.
 *
 * The `tolerance`, in metres, applies to the ground and to the turn of the
 * vertical only: each moves with every pan, a few metres at a time, and every
 * move re-traverses the whole tree. The trim is what the user asked for, and
 * any change to it moves the tileset.
 */
export function needsMove(applied: Placement | null, next: Placement, tolerance: number): boolean {
  if (!applied || Math.abs(next.trim - applied.trim) > EPSILON) {
    return true;
  }
  if (Math.abs(next.ground - applied.ground) >= tolerance) {
    return true;
  }
  const turn = Math.hypot(next.up[0] - applied.up[0], next.up[1] - applied.up[1], next.up[2] - applied.up[2]);
  return Math.abs(next.trim - next.ground) * turn >= tolerance;
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
 * it knows the view — when its tree can be read there ({@link groundsUnderView});
 * otherwise it stays where it is.
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

/*
 * Tiles already loaded, moved with the tileset.
 *
 * loaders.gl works out how to draw a tile once, when its content loads
 * (`calculateTransformProps`, `@loaders.gl/tiles`): an origin, and matrices from
 * the tile's geometry to ECEF and to metres round that origin. deck's
 * `Tile3DLayer` draws every sublayer with them for as long as the tile stays
 * loaded. Moving the tileset afterwards moved the bounding volumes the
 * traversal culls against, and left the drawn geometry where it had been: over
 * Cuenca, 2 400 m above a street-level camera. So every loaded tile is moved by
 * the same step as the tileset, to the numbers loaders.gl would have given it
 * had it loaded where the tileset now is. Worked out again here rather than by
 * calling loaders.gl's own: that one also folds the glTF's root node into the
 * matrices, once, and running it twice would fold it in twice.
 */

/** WGS 84's polar radius, in metres. */
const POLAR_RADIUS = EARTH_RADIUS * Math.sqrt(1 - WGS84_E2);

/**
 * ECEF to `[longitude, latitude, height]`, in degrees and metres: math.gl's
 * `cartesianToCartographic`, which is what loaders.gl gives deck.
 */
function cartographicOf(point: ArrayLike<number>): Vec3 {
  const [x, y, z] = [point[0], point[1], point[2]];
  const p = Math.hypot(x, y);
  let latitude = Math.atan2(z, p * (1 - WGS84_E2));
  let height = 0;
  for (let i = 0; i < 8; i++) {
    const n = EARTH_RADIUS / Math.sqrt(1 - WGS84_E2 * Math.sin(latitude) ** 2);
    height =
      Math.abs(Math.cos(latitude)) > 1e-6
        ? p / Math.cos(latitude) - n
        : Math.abs(z) / Math.abs(Math.sin(latitude)) - n * (1 - WGS84_E2);
    latitude = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + height)));
  }
  return [(Math.atan2(y, x) * 180) / Math.PI, (latitude * 180) / Math.PI, height];
}

/**
 * The east, north and up axes at a point in ECEF, as math.gl's
 * `eastNorthUpToFixedFrame` builds them for loaders.gl: up is the ellipsoid's
 * normal scaled from the point itself, and a point on the axis gets fixed ones.
 */
function eastNorthUp(point: ArrayLike<number>): [Vec3, Vec3, Vec3] {
  const [x, y, z] = [point[0], point[1], point[2]];
  if (Math.abs(x) < 1e-14 && Math.abs(y) < 1e-14) {
    const sign = Math.sign(z) || 1;
    return [
      [0, 1, 0],
      [-sign, 0, 0],
      [0, 0, sign],
    ];
  }
  const normal: Vec3 = [x / EARTH_RADIUS ** 2, y / EARTH_RADIUS ** 2, z / POLAR_RADIUS ** 2];
  const n = Math.hypot(...normal);
  const up: Vec3 = [normal[0] / n, normal[1] / n, normal[2] / n];
  const e = Math.hypot(x, y);
  const east: Vec3 = [-y / e, x / e, 0];
  const north: Vec3 = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];
  return [east, north, up];
}

/**
 * A copy of a math.gl vector or matrix, of the same kind, holding new values.
 *
 * A copy rather than the same one written over: deck compares a sublayer's
 * `modelMatrix` and `coordinateOrigin` with the last ones, and one written in
 * place compares equal to itself.
 */
function copyWith<T>(source: T, values: readonly number[]): T {
  const cloneable = source as unknown as { clone?: () => unknown } | null | undefined;
  const copy = (typeof cloneable?.clone === 'function' ? cloneable.clone() : [...values]) as number[];
  values.forEach((value, i) => (copy[i] = value));
  return copy as unknown as T;
}

/**
 * Moves one loaded tile's content by `delta` (ECEF, metres): the origin, and
 * both matrices, as loaders.gl would have worked them out with the tileset
 * already there. Returns whether there was anything to move.
 */
export function shiftContent(content: TileContentLike | null | undefined, delta: ArrayLike<number>): boolean {
  const origin = content?.cartesianOrigin;
  const cartesian = content?.cartesianModelMatrix;
  if (!content || !origin || origin.length < 3 || !cartesian || cartesian.length < 16) {
    return false;
  }

  const movedOrigin: Vec3 = [origin[0] + delta[0], origin[1] + delta[1], origin[2] + delta[2]];
  // Translated by delta, on the left: what the tileset's own move does to every transform below it.
  const moved = Array.from({ length: 16 }, (_, i) => cartesian[i]);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 3; row++) {
      moved[column * 4 + row] += delta[row] * cartesian[column * 4 + 3];
    }
  }
  // The same, seen from the east, north and up of the new origin: the inverse
  // of that frame, which is its transpose and the origin taken off.
  const axes = eastNorthUp(movedOrigin);
  const local = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    const c = [moved[column * 4], moved[column * 4 + 1], moved[column * 4 + 2]];
    const w = moved[column * 4 + 3];
    axes.forEach((axis, row) => {
      local[column * 4 + row] =
        axis[0] * (c[0] - w * movedOrigin[0]) +
        axis[1] * (c[1] - w * movedOrigin[1]) +
        axis[2] * (c[2] - w * movedOrigin[2]);
    });
    local[column * 4 + 3] = w;
  }

  const oldLocal = content.cartographicModelMatrix;
  const newLocal = copyWith(oldLocal ?? cartesian, local);
  if (oldLocal && content.modelMatrix === oldLocal) {
    content.modelMatrix = newLocal;
  }
  content.cartographicModelMatrix = newLocal;
  content.cartesianModelMatrix = copyWith(cartesian, moved);
  content.cartesianOrigin = copyWith(origin, movedOrigin);
  content.cartographicOrigin = copyWith(content.cartographicOrigin ?? origin, cartographicOf(movedOrigin));
  return true;
}

/** Every tile the tileset keeps — the tree for each viewport, the first one, and the ones last selected — once each. */
function everyTile(tileset: TilesetLike): Set<TileLike> {
  const found = new Set<TileLike>();
  const stack: TileLike[] = [];
  const add = (tile: TileLike | null | undefined) => {
    if (tile && typeof tile === 'object' && !found.has(tile)) {
      found.add(tile);
      stack.push(tile);
    }
  };
  Object.values(tileset.roots ?? {}).forEach(add);
  add(tileset.root);
  (tileset.tiles ?? []).forEach(add);
  while (stack.length > 0) {
    (stack.pop()!.children ?? []).forEach(add);
  }
  return found;
}

/** Column-major 4×4 product. */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * Moves a tile that has just loaded to where the tileset is now, when it
 * loaded against where the tileset was.
 *
 * A tile still loading when the tileset moved, and not traversed since, keeps
 * the transform of before the move, and loaders.gl works out how to draw it
 * from that one. Only the tileset's translation ever changes, so the tile is
 * behind by exactly the difference between that transform and the one it would
 * have now — the tileset's model matrix times every transform down to it.
 */
export function catchUpTile(tile: TileLike | null | undefined): boolean {
  const model = tile?.tileset?.modelMatrix;
  const computed = tile?.computedTransform;
  if (!tile || !model || model.length < 16 || !computed || computed.length < 16) {
    return false;
  }
  const chain: TileLike[] = [];
  for (let ancestor: TileLike | null | undefined = tile; ancestor; ancestor = ancestor.parent) {
    chain.unshift(ancestor);
  }
  let expected: ArrayLike<number> = model;
  for (const link of chain) {
    if (link.transform && link.transform.length >= 16 && !isIdentity(link.transform)) {
      expected = multiply(expected, link.transform);
    }
  }
  const delta = [expected[12] - computed[12], expected[13] - computed[13], expected[14] - computed[14]];
  if (Math.hypot(delta[0], delta[1], delta[2]) < EPSILON) {
    return false;
  }
  return shiftContent(tile.content, delta);
}

/**
 * Writes the offset into the tileset's model matrix, and moves every tile
 * already loaded by the same step (see above).
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
 * the vertical at the centre of the view instead ({@link upAt}).
 */
export function applyAltitude(
  tileset: TilesetLike | null | undefined,
  offset: number,
  options: { up?: Vec3 } = {}
): boolean {
  const matrix = tileset?.modelMatrix;
  if (!tileset || !matrix || typeof matrix.clone !== 'function' || !Number.isFinite(offset)) {
    return false;
  }

  const up = options.up ?? tilesetUp(tileset);
  const wanted = [up[0] * offset, up[1] * offset, up[2] * offset];
  const delta = [wanted[0] - matrix[12], wanted[1] - matrix[13], wanted[2] - matrix[14]];
  if (Math.hypot(delta[0], delta[1], delta[2]) < EPSILON) {
    return false;
  }

  // Cloned rather than written in place: math.gl matrices are handed around by
  // reference, and deck compares props by identity to decide what changed.
  const next = matrix.clone() as ArrayLike<number> & { clone(): ArrayLike<number> };
  const writable = next as unknown as number[];
  writable[12] = wanted[0];
  writable[13] = wanted[1];
  writable[14] = wanted[2];
  tileset.modelMatrix = next;

  for (const tile of everyTile(tileset)) {
    shiftContent(tile.content, delta);
  }
  return true;
}
