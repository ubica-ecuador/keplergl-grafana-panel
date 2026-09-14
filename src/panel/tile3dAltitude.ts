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

/** The parts of a loaded `Tileset3D` this module reads. */
export interface TilesetLike {
  /** math.gl `Matrix4` — an `Array` subclass, column-major, with a `clone`. */
  modelMatrix?: (ArrayLike<number> & { clone(): ArrayLike<number> }) | null;
  /** `[longitude, latitude, altitude]` of the root bounding volume's centre. */
  cartographicCenter?: ArrayLike<number> | null;
  root?: {
    transform?: ArrayLike<number> | null;
    header?: { boundingVolume?: Record<string, ArrayLike<number>> } | null;
  } | null;
}

/** Straight up, for a tileset that is not georeferenced onto the globe. */
const STRAIGHT_UP: [number, number, number] = [0, 0, 1];

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
 * signal to leave it where it is rather than to guess.
 */
export function baseAltitude(tileset: TilesetLike | null | undefined): number | null {
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
 */
export function altitudeOffsetFor(visConfig: AltitudeVisConfig, tileset: TilesetLike | null | undefined): number {
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
 */
export function applyAltitude(tileset: TilesetLike | null | undefined, offset: number): boolean {
  const matrix = tileset?.modelMatrix;
  if (!matrix || typeof matrix.clone !== 'function' || !Number.isFinite(offset)) {
    return false;
  }

  const up = localUp(tileset?.root?.transform);
  const wanted = [up[0] * offset, up[1] * offset, up[2] * offset];
  if (wanted.every((value, axis) => Math.abs(value - matrix[12 + axis]) < EPSILON)) {
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
