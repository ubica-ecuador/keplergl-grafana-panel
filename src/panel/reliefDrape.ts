import { LayerExtension } from '@deck.gl/core';
import { BitmapLayer } from '@deck.gl/layers';

/**
 * Raster layers lying on the basemap's relief.
 *
 * Every raster kepler and the panel draw — kepler's Raster Tile and WMS, the
 * panel's XYZ, Zarr, COG and Esri image layers — ends in deck's `BitmapLayer`:
 * a flat picture, two triangles at z = 0. On a relief basemap MapLibre draws
 * the ground in 3D, and deck, aiming at z = 0 under the centre of the view
 * (`terrainAnchor.ts`), draws the picture as a sheet at the centre's height,
 * cutting through the hills and floating over the valleys.
 *
 * This extension gives each bitmap a grid instead of the two triangles, each
 * vertex at the ground under it (MapLibre's own answer, the surface it draws),
 * and the layer is lowered by the ground under the centre with the same model
 * matrix as the markers. The grid is spaced evenly in Web Mercator, so a
 * picture in Mercator keeps its texture coordinates exact; one in longitude and
 * latitude reads its own from the position (`_imageCoordinateSystem`).
 *
 * It works on the bitmap's mesh in its state, after the layer's own update has
 * made its flat one: the attribute updaters read `state.mesh`, so the grid is
 * what gets drawn. With no relief (`reliefDrape` null) it puts the flat mesh
 * back, so a basemap switched to a flat one leaves nothing in the air.
 */

/** The relief as the drape reads it: a new object only when MapLibre has more of it. */
export interface ReliefDrape {
  version: number;
  /** Elevation of the ground at a point, metres, exaggeration included; 0 where there is none. */
  elevationAt(lng: number, lat: number): number;
  /** The grids made on this relief, by cells and corners: a tile's sublayer is made again on every pan. */
  meshes: Map<string, Mesh>;
  /** The lowest and highest ground the grids have met on this map, metres: for a tile layer's culling (`zRange`). */
  range: GroundRange;
}

/** Kept by the map across versions of its relief: a new version starts with no grid of its own yet. */
export interface GroundRange {
  low: number;
  high: number;
}

export interface Mesh {
  vertexCount: number;
  positions: Float64Array;
  indices: Uint32Array;
  texCoords: Float32Array;
}

type Corner = [number, number];

/** Pixels on screen between two vertices of the grid, at the zoom the grid is made at. */
const CELL_PX = 12;
const MIN_CELLS = 4;
const MAX_CELLS = 128;
/** Grids one relief remembers. */
const CACHED_MESHES = 512;

function remember(cache: Map<string, Mesh>, key: string, mesh: Mesh): Mesh {
  if (cache.size >= CACHED_MESHES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, mesh);
  return mesh;
}

/** Web Mercator y of a latitude, in the 0..1 world (north up = 0). */
function mercY(lat: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function latOf(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** A BitmapLayer's `bounds` as its four corners: bottom-left, top-left, top-right, bottom-right. */
export function cornersOf(bounds: unknown): [Corner, Corner, Corner, Corner] | null {
  if (!Array.isArray(bounds)) {
    return null;
  }
  if (bounds.length === 4 && bounds.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    const [w, s, e, n] = bounds as number[];
    return [
      [w, s],
      [w, n],
      [e, n],
      [e, s],
    ];
  }
  if (
    bounds.length === 4 &&
    bounds.every((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
  ) {
    return (bounds as number[][]).map((c) => [Number(c[0]), Number(c[1])]) as [Corner, Corner, Corner, Corner];
  }
  return null;
}

/** How many cells across the grid has: about one every `CELL_PX` on screen, a power of two so zooms share grids. */
/** A grid's size: cells across, and cells along each side (left, top, right, bottom), each at most `cells`. */
export interface GridSize {
  cells: number;
  sides: [number, number, number, number];
}

function cellsForPixels(pixels: number): number {
  const wanted = Math.min(MAX_CELLS, Math.max(MIN_CELLS, Math.ceil(pixels / CELL_PX)));
  return Math.pow(2, Math.ceil(Math.log2(wanted)));
}

/**
 * The grid for where the corners fall on screen: a tile near the horizon of a pitched view is a few pixels tall and
 * needs few cells, one under the camera many. Each side gets its own count from its own length on screen, which
 * the tile on the other side of it works out the same way: both cut the side at the same points, so their edges
 * meet with no sliver between them. Off screen, or with no projection, by the zoom alone, every side alike.
 */
export function gridOnScreen(
  corners: readonly Corner[],
  viewport: { zoom: number; project?(xyz: number[]): number[] }
): GridSize {
  const even = (): GridSize => {
    const cells = cellsFor(corners, viewport.zoom);
    return { cells, sides: [cells, cells, cells, cells] };
  };
  if (typeof viewport.project !== 'function') {
    return even();
  }
  const px = corners.map((c) => viewport.project!([c[0], c[1], 0]));
  if (px.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
    return even();
  }
  const length = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sides = [
    cellsForPixels(length(px[0], px[1])),
    cellsForPixels(length(px[1], px[2])),
    cellsForPixels(length(px[2], px[3])),
    cellsForPixels(length(px[3], px[0])),
  ] as [number, number, number, number];
  return { cells: Math.max(...sides), sides };
}

export function cellsFor(corners: readonly Corner[], zoom: number): number {
  const xs = corners.map((c) => (c[0] + 180) / 360);
  const ys = corners.map((c) => mercY(c[1]));
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pixels = span * 512 * Math.pow(2, Number.isFinite(zoom) ? zoom : 0);
  const wanted = Math.min(MAX_CELLS, Math.max(MIN_CELLS, Math.ceil(pixels / CELL_PX)));
  return Math.pow(2, Math.ceil(Math.log2(wanted)));
}

/**
 * The bitmap's grid on the ground: `cells` × `cells` quads between the four
 * corners, interpolated in Web Mercator, each vertex at `elevationAt` there.
 * Texture coordinates and triangle order as deck's own `createMesh`.
 */
export function drapedMesh(
  corners: readonly Corner[],
  grid: number | GridSize,
  elevationAt: (lng: number, lat: number) => number
): Mesh {
  const { cells, sides } = typeof grid === 'number' ? { cells: grid, sides: [grid, grid, grid, grid] } : grid;
  const merc = corners.map((c) => [(c[0] + 180) / 360, mercY(c[1])]);
  const count = cells + 1;
  const positions = new Float64Array(count * count * 3);
  const texCoords = new Float32Array(count * count * 2);
  const indices = new Uint32Array(cells * cells * 6);
  const lerp = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let vertex = 0;
  let index = 0;
  for (let u = 0; u < count; u++) {
    const ut = u / cells;
    for (let v = 0; v < count; v++) {
      const vt = v / cells;
      const p = lerp(lerp(merc[0], merc[1], vt), lerp(merc[3], merc[2], vt), ut);
      const lng = p[0] * 360 - 180;
      const lat = latOf(p[1]);
      const z = elevationAt(lng, lat);
      positions[vertex * 3] = lng;
      positions[vertex * 3 + 1] = lat;
      positions[vertex * 3 + 2] = Number.isFinite(z) ? z : 0;
      texCoords[vertex * 2] = ut;
      texCoords[vertex * 2 + 1] = 1 - vt;
      if (u > 0 && v > 0) {
        indices[index++] = vertex - count;
        indices[index++] = vertex - count - 1;
        indices[index++] = vertex - 1;
        indices[index++] = vertex - count;
        indices[index++] = vertex - 1;
        indices[index++] = vertex;
      }
      vertex++;
    }
  }
  // Each side as its own count of cells cuts it: the vertices between its cuts on the line between them.
  const at = (u: number, v: number) => u * count + v;
  const sideVertices = [
    (i: number) => at(0, i), // left: corner 0 to 1
    (i: number) => at(i, cells), // top: corner 1 to 2
    (i: number) => at(cells, cells - i), // right: corner 2 to 3
    (i: number) => at(cells - i, 0), // bottom: corner 3 to 0
  ];
  sides.forEach((sideCells, k) => {
    const step = cells / sideCells;
    if (!(step > 1) || !Number.isInteger(step)) {
      return;
    }
    const vertexAt = sideVertices[k];
    for (let i = 0; i <= cells; i++) {
      const a = Math.floor(i / step) * step;
      if (a === i) {
        continue;
      }
      const za = positions[vertexAt(a) * 3 + 2];
      const zb = positions[vertexAt(a + step) * 3 + 2];
      positions[vertexAt(i) * 3 + 2] = za + ((zb - za) * (i - a)) / step;
    }
  });
  return { vertexCount: cells * cells * 6, positions, indices, texCoords };
}

interface BitmapLike {
  props: { bounds?: unknown; reliefDrape?: ReliefDrape | null };
  state: {
    mesh?: Mesh;
    model?: { setVertexCount(count: number): void };
    reliefDrapeMesh?: Mesh | null;
  };
  context: { viewport: { zoom: number; project?(xyz: number[]): number[] } };
  setState(state: Record<string, unknown>): void;
  getAttributeManager(): { invalidate(name: string): void } | null;
  _createMesh(): Mesh;
}

function drawMesh(layer: BitmapLike, mesh: Mesh, draped: Mesh | null): void {
  layer.state.model?.setVertexCount(mesh.vertexCount);
  const attributes = layer.getAttributeManager();
  for (const name of ['positions', 'texCoords', 'indices']) {
    attributes?.invalidate(name);
  }
  layer.setState({ mesh, reliefDrapeMesh: draped });
}

export class ReliefDrapeExtension extends LayerExtension {
  static extensionName = 'ReliefDrapeExtension';
  static defaultProps = {
    reliefDrape: { type: 'object', value: null, compare: false },
  };

  updateState(this: unknown): void {
    if (!(this instanceof BitmapLayer)) {
      return;
    }
    const layer = this as unknown as BitmapLike;
    const relief = layer.props.reliefDrape ?? null;
    const current = layer.state.mesh;
    const draped = layer.state.reliefDrapeMesh ?? null;
    if (!current) {
      return;
    }
    if (!relief) {
      // Off the relief: the flat mesh back, if ours is still the one drawn.
      if (draped && current === draped) {
        drawMesh(layer, layer._createMesh(), null);
      }
      return;
    }
    const corners = cornersOf(layer.props.bounds);
    if (!corners) {
      return;
    }
    const grid = gridOnScreen(corners, layer.context.viewport);
    const key = `${grid.sides.join(',')}|${corners.map((c) => c.join(',')).join(';')}`;
    let mesh = relief.meshes.get(key);
    if (!mesh) {
      mesh = remember(relief.meshes, key, drapedMesh(corners, grid, relief.elevationAt));
      for (let i = 2; i < mesh.positions.length; i += 3) {
        const z = mesh.positions[i];
        relief.range.low = Math.min(relief.range.low, z);
        relief.range.high = Math.max(relief.range.high, z);
      }
    }
    if (mesh !== current) {
      drawMesh(layer, mesh, mesh);
    } else {
      // A model made again (new extensions) starts with no vertex count; deck's bitmap sets one only with a new mesh.
      layer.state.model?.setVertexCount(mesh.vertexCount);
    }
  }
}

/** One instance for every layer: deck rebuilds a layer's model whenever its extensions differ. */
export const RELIEF_DRAPE = new ReliefDrapeExtension();

const drapes = new WeakMap<object, ReliefDrape>();

type TileSampler = (x: number, y: number, extent: number) => number;

interface TerrainInternals {
  exaggeration?: number;
  getElevationSampler(tileID: unknown): TileSampler | null;
  _getOverscaledTileIDFromLngLatZoom(lngLat: unknown, zoom: number): { tileID: unknown };
}

/** MapLibre's tile extent, the unit its samplers take. */
const EXTENT = 8192;

/**
 * The ground for the grids, read straight off MapLibre's elevation tiles.
 *
 * `queryTerrainElevation` samples the surface MapLibre draws where it has one, and elsewhere works out which tiles
 * cover the view on every call: while the relief loaded, a few thousand vertices kept the page busy long enough that
 * MapLibre never asked for its tiles; and even with the relief loaded each call builds a handful of objects. A grid
 * wants thousands of points per tile, so this asks MapLibre once per elevation tile, at the map's zoom, for the
 * function its own CPU sampling uses (bilinear, DEM pixels at cell centres, a coarser tile while a finer one loads),
 * and works out each point's place in that tile itself. `Terrain` is MapLibre's internal class, kept whole by its
 * build: with neither method there, the drape uses the given lookup instead.
 */
export function drapeSampler(
  map: { terrain?: unknown; getZoom?(): number; getCenter?(): object },
  fallback: (lng: number, lat: number) => number
): (lng: number, lat: number) => number {
  // Read on the first point, not when the lookup is made: MapLibre may set its terrain after that, and a lookup
  // lives until the relief changes.
  let read: ((lng: number, lat: number) => number) | null = null;
  const sample = (lng: number, lat: number) => {
    read ??= tileReader(map) ?? (map.terrain ? fallback : () => 0);
    return read(lng, lat);
  };
  return sample;
}

function tileReader(map: {
  terrain?: unknown;
  getZoom?(): number;
  getCenter?(): object;
}): ((lng: number, lat: number) => number) | null {
  const terrain = map.terrain as Partial<TerrainInternals> | null | undefined;
  const LngLat = map.getCenter?.()?.constructor as (new (lng: number, lat: number) => unknown) | undefined;
  if (
    !terrain ||
    typeof terrain.getElevationSampler !== 'function' ||
    typeof terrain._getOverscaledTileIDFromLngLatZoom !== 'function' ||
    !LngLat ||
    !map.getZoom
  ) {
    return null;
  }
  const internals = terrain as TerrainInternals;
  const exaggeration = Number(internals.exaggeration) || 1;
  const zoom = Math.max(0, Math.min(22, Math.floor(map.getZoom())));
  const tiles = 2 ** zoom;
  const samplers = new Map<number, TileSampler | null>();
  return (lng, lat) => {
    const fx = (((((lng + 180) % 360) + 360) % 360) / 360) * tiles;
    const fy = mercY(lat) * tiles;
    const tx = Math.min(tiles - 1, Math.floor(fx));
    const ty = Math.min(tiles - 1, Math.max(0, Math.floor(fy)));
    const key = ty * tiles + tx;
    let sampler = samplers.get(key);
    if (sampler === undefined) {
      const centre = new LngLat(((tx + 0.5) / tiles) * 360 - 180, latOf((ty + 0.5) / tiles));
      const { tileID } = internals._getOverscaledTileIDFromLngLatZoom(centre, zoom);
      sampler = internals.getElevationSampler(tileID) ?? null;
      samplers.set(key, sampler);
    }
    if (!sampler) {
      return 0;
    }
    const value = sampler((fx - tx) * EXTENT, (fy - ty) * EXTENT, EXTENT) * exaggeration;
    return Number.isFinite(value) ? value : 0;
  };
}

/** The drape for a lookup, the same object for the same lookup, so deck sees no change between two renders. */
export function reliefDrapeOf(lookup: {
  version: number;
  elevationAt: ReliefDrape['elevationAt'];
  drapeAt?: ReliefDrape['elevationAt'];
  range?: GroundRange;
}): ReliefDrape {
  const elevationAt = lookup.drapeAt ?? lookup.elevationAt;
  let drape = drapes.get(elevationAt);
  if (!drape) {
    drape = {
      version: lookup.version,
      elevationAt,
      meshes: new Map(),
      range: lookup.range ?? { low: Infinity, high: -Infinity },
    };
    drapes.set(elevationAt, drape);
  }
  return drape;
}
