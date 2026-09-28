/**
 * What loaders.gl and luma.gl get wrong about real 3D tilesets, put right as
 * each piece loads.
 *
 * Three faults, each of which left a real tileset drawing nothing, with no
 * error a user could act on (measured 2026-09-28, loaders.gl 4.4 / luma.gl 9.3;
 * still there in loaders.gl 4.5.2 and luma.gl 9.4.2):
 *
 * - **A region round the whole world is culled away.** loaders.gl builds a
 *   region's box from two opposite corners (`createObbFromRegion`). For Cesium
 *   OSM Buildings, whose regions reach from −180° to 180°, both corners sit on
 *   the same meridian, the "box" is a slab along the antimeridian, and nothing
 *   below the root was ever asked for. And it ignores every transform, so a
 *   region tileset lowered onto the map was still culled where it had been.
 *   Every region gets a box that holds it ({@link regionBox}); loaders.gl reads
 *   a box before a region.
 * - **A glTF with nothing to draw switches the layer off.** OSM Buildings' first
 *   tile is a 400-byte glTF with no `meshes` — valid glTF. luma.gl walks
 *   `gltf.meshes` without asking, throws, and deck disables the whole layer.
 * - **An ion asset served from elsewhere is asked of ion.** For Google's 3D
 *   Tiles through ion, ion answers with Google's URL under `options`. loaders.gl
 *   reads it there but hands deck no `url`, so deck asked ion's own URL and got
 *   a 401. And the ion token it would have sent along belongs to ion, not to
 *   whoever serves the asset.
 *
 * **Why wrap the loader.** Tileset3D loads every tile and nested tileset with
 * the loader the tileset JSON names, and loaders.gl names its own
 * `Tiles3DLoader` there whatever loader parsed the root. So the wrapper names
 * itself, and every level below passes through it.
 */

/** A loaders.gl loader, as far as this module cares. */
export interface LoaderLike {
  id?: string;
  parse?: (data: ArrayBuffer, options?: unknown, context?: unknown) => Promise<any>;
  preload?: (url: string, options?: unknown) => Promise<Record<string, any>>;
  [key: string]: unknown;
}

/** The loaders this module mends: 3D Tiles, and 3D Tiles through Cesium ion. I3S is left alone. */
const MENDED_LOADERS = new Set(['3d-tiles', 'cesium-ion']);

/**
 * A region wider or taller than this, in radians, is boxed as a whole in ECEF
 * ({@link enclosingBox}); a narrower one along its own east, north and up, which
 * holds it far more tightly while the ground under it is still nearly flat.
 */
const WIDE_REGION = Math.PI / 180;

/** Grid lines each way when sampling a region for its box. */
const SAMPLES = 33;

const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;

const wrappers = new WeakMap<object, LoaderLike>();
const wrapped = new WeakSet<object>();

/** WGS 84 geodetic coordinates, in radians and metres, to ECEF. */
function ecef(longitude: number, latitude: number, height: number): [number, number, number] {
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(latitude) ** 2);
  return [
    (n + height) * Math.cos(latitude) * Math.cos(longitude),
    (n + height) * Math.cos(latitude) * Math.sin(longitude),
    (n * (1 - WGS84_E2) + height) * Math.sin(latitude),
  ];
}

/**
 * An ECEF box, axis-aligned, that holds all of a region at every height it
 * allows: `[centre(3), xHalfAxis(3), yHalfAxis(3), zHalfAxis(3)]`.
 *
 * Built from a grid over the region at its lowest and highest heights. The
 * surface bulges between grid lines by at most `r·(1 − cos(step/2))` along each
 * direction, so each half-axis is widened by that much and the box can only be
 * too big, never too small. A point between the two heights lies on the segment
 * between two grid points, which the box already holds.
 */
export function enclosingBox(region: ArrayLike<number>): number[] {
  const west = region[0];
  const east = region[2] < west ? region[2] + 2 * Math.PI : region[2];
  const [south, north, lowest, highest] = [region[1], region[3], region[4], region[5]];

  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < SAMPLES; i++) {
    const longitude = west + ((east - west) * i) / (SAMPLES - 1);
    for (let j = 0; j < SAMPLES; j++) {
      const latitude = south + ((north - south) * j) / (SAMPLES - 1);
      for (const height of [lowest, highest]) {
        ecef(longitude, latitude, height).forEach((value, axis) => {
          low[axis] = Math.min(low[axis], value);
          high[axis] = Math.max(high[axis], value);
        });
      }
    }
  }

  const reach = WGS84_A + Math.max(highest, 0);
  const halfStep = (angle: number) => angle / (SAMPLES - 1) / 2;
  const bulge = reach * (1 - Math.cos(halfStep(east - west)) + (1 - Math.cos(halfStep(north - south)))) + 1;

  const centre = low.map((value, axis) => (value + high[axis]) / 2);
  const half = low.map((value, axis) => (high[axis] - value) / 2 + bulge);
  return [...centre, half[0], 0, 0, 0, half[1], 0, 0, 0, half[2]];
}

function isWide(region: ArrayLike<number>): boolean {
  const width = region[2] < region[0] ? region[2] + 2 * Math.PI - region[0] : region[2] - region[0];
  return width > WIDE_REGION || region[3] - region[1] > WIDE_REGION;
}

/**
 * A box along a small region's own east, north and up that holds all of it:
 * `[centre(3), eastHalfAxis(3), northHalfAxis(3), upHalfAxis(3)]`.
 *
 * Every half-axis errs on the large side: the east one at the region's widest
 * latitude, the north one with the ellipsoid's largest meridian radius, and
 * the up one reaching down by how far the ground curves away from the centre
 * at the region's corners.
 */
function localBox(region: ArrayLike<number>): number[] {
  const west = region[0];
  const east = region[2] < west ? region[2] + 2 * Math.PI : region[2];
  const [south, north, lowest, highest] = [region[1], region[3], region[4], region[5]];
  const longitude = (west + east) / 2;
  const latitude = (south + north) / 2;
  const halfLongitude = (east - west) / 2;
  const halfLatitude = (north - south) / 2;

  const reach = WGS84_A / (1 - WGS84_E2) + Math.max(highest, 0);
  const widest = south <= 0 && north >= 0 ? 1 : Math.cos(Math.min(Math.abs(south), Math.abs(north)));
  const halfEast = reach * widest * halfLongitude + 1;
  const halfNorth = reach * halfLatitude + 1;
  const corner = Math.hypot(halfLongitude * widest, halfLatitude);
  const bottom = lowest - reach * (1 - Math.cos(corner));
  const middle = (bottom + highest) / 2;
  const halfUp = (highest - bottom) / 2 + 1;

  const eastAxis = [-Math.sin(longitude), Math.cos(longitude), 0];
  const northAxis = [
    -Math.sin(latitude) * Math.cos(longitude),
    -Math.sin(latitude) * Math.sin(longitude),
    Math.cos(latitude),
  ];
  const upAxis = [
    Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
  ];
  return [
    ...ecef(longitude, latitude, middle),
    ...eastAxis.map((v) => v * halfEast),
    ...northAxis.map((v) => v * halfNorth),
    ...upAxis.map((v) => v * halfUp),
  ];
}

/** A box that holds a region: {@link enclosingBox} for a wide one, {@link localBox} under a degree. */
export function regionBox(region: ArrayLike<number>): number[] {
  return isWide(region) ? enclosingBox(region) : localBox(region);
}

/**
 * Gives every region in a tile header tree a box that holds it.
 *
 * loaders.gl builds a region's volume from two corners and ignores every
 * transform, the tileset's model matrix included: the corners fail a region
 * round the whole world, and the model matrix is how the panel puts a tileset
 * on the ground. So grounding moved a region tileset's buildings down to the
 * map while loaders.gl culled them where they had been, above a street-level
 * camera. A box is transformed, and loaders.gl reads a box before a region.
 *
 * The region stays beside the box: the altitude code (`tile3dAltitude.ts`) reads
 * a region's own heights, which are exact. Not below a transform of the tile
 * tree's own, though: a box would be moved by it and a region never is.
 */
function boxRegions(header: Record<string, any> | null | undefined, underTransform = false): void {
  if (!header || typeof header !== 'object') {
    return;
  }
  const transformed = underTransform || Boolean(header.transform ?? header.transformMatrix);
  const volume = header.boundingVolume;
  const region = volume?.region;
  if (!transformed && !volume?.box && Array.isArray(region) && region.length >= 6) {
    volume.box = regionBox(region);
  }
  if (Array.isArray(header.children)) {
    for (const child of header.children) {
      boxRegions(child, transformed);
    }
  }
}

/** Gives a glTF with no meshes an empty list of them, processed or not. */
function fillMeshes(gltf: Record<string, any> | null | undefined): void {
  if (!gltf || typeof gltf !== 'object') {
    return;
  }
  if (gltf.json && typeof gltf.json === 'object') {
    if (!Array.isArray(gltf.json.meshes)) {
      gltf.json.meshes = [];
    }
    return;
  }
  if (!Array.isArray(gltf.meshes)) {
    gltf.meshes = [];
  }
}

function mend(parsed: any): any {
  if (parsed?.shape === 'tileset3d') {
    boxRegions(parsed.root);
    parsed.loader = sturdyLoader(parsed.loader);
  } else if (parsed?.gltf) {
    fillMeshes(parsed.gltf);
  }
  return parsed;
}

function servedByIon(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'cesium.com' || host.endsWith('.cesium.com');
  } catch {
    return false;
  }
}

/** ion's description of an asset, with the URL deck reads, and ion's token only where ion serves it. */
function followServedUrl(described: Record<string, any>): Record<string, any> {
  const url = described?.url ?? described?.options?.url;
  if (typeof url !== 'string' || !url) {
    return described;
  }
  const { headers, ...rest } = described;
  return servedByIon(url) ? { ...described, url } : { ...rest, url, headers: undefined };
}

/**
 * A 3D Tiles loader, mended as this module's comment describes; any other loader, as it was.
 *
 * One wrapper per loader, for the life of the page: deck decides whether its
 * props changed by identity, and a new loader on every render would reload the
 * tileset from scratch.
 */
export function sturdyLoader<L>(loader: L): L {
  const base = loader as unknown as LoaderLike;
  if (!base || typeof base !== 'object' || wrapped.has(base) || !MENDED_LOADERS.has(String(base.id))) {
    return loader;
  }
  const cached = wrappers.get(base);
  if (cached) {
    return cached as unknown as L;
  }
  const parse = base.parse;
  const preload = base.preload;
  const sturdy: LoaderLike = {
    ...base,
    parse: async (data, options, context) => mend(await parse!.call(base, data, options, context)),
    ...(typeof preload === 'function'
      ? { preload: async (url: string, options?: unknown) => followServedUrl(await preload.call(base, url, options)) }
      : {}),
  };
  wrapped.add(sturdy);
  wrappers.set(base, sturdy);
  return sturdy as unknown as L;
}
