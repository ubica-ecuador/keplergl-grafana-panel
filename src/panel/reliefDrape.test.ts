import { BitmapLayer } from '@deck.gl/layers';

import {
  cellsFor,
  cornersOf,
  drapedMesh,
  drapeSampler,
  gridOnScreen,
  RELIEF_DRAPE,
  reliefDrapeOf,
} from './reliefDrape';

describe('cornersOf', () => {
  it('reads [west, south, east, north] as four corners, bottom-left first and clockwise', () => {
    expect(cornersOf([-79, -2, -78, -1])).toEqual([
      [-79, -2],
      [-79, -1],
      [-78, -1],
      [-78, -2],
    ]);
  });

  it('keeps four corners as they are, without their heights', () => {
    expect(
      cornersOf([
        [0, 0, 5],
        [0, 1],
        [1, 1],
        [1, 0],
      ])
    ).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]);
  });

  it('refuses anything else', () => {
    expect(cornersOf(undefined)).toBeNull();
    expect(cornersOf([1, 2, 3])).toBeNull();
    expect(cornersOf([1, 2, 3, Number.NaN])).toBeNull();
  });
});

describe('cellsFor', () => {
  const tile = cornersOf([-78.75, -1.362, -78.706, -1.318])!; // about one z13 tile, which deck draws at zoom 12

  it('gives a tile on screen about one cell every 12 pixels, a power of two', () => {
    expect(cellsFor(tile, 12)).toBe(32);
    expect(cellsFor(tile, 13)).toBe(64);
  });

  it('keeps between 4 and 128 cells', () => {
    expect(cellsFor(tile, 2)).toBe(4);
    expect(cellsFor(cornersOf([-180, -85, 180, 85])!, 6)).toBe(128);
  });
});

describe('gridOnScreen', () => {
  const corners = cornersOf([0, 0, 1, 1])!;

  it('gives each side its cells from its own length on screen, the grid the most of them', () => {
    // A trapezoid on screen: the near side 400 px, the far one 40 px, the sides 200 px.
    const screen: Record<string, number[]> = {
      '0,0': [0, 400],
      '0,1': [180, 200],
      '1,1': [220, 200],
      '1,0': [400, 400],
    };
    const viewport = { zoom: 10, project: ([x, y]: number[]) => screen[`${x},${y}`] };
    const grid = gridOnScreen(corners, viewport);
    expect(grid.sides).toEqual([32, 4, 32, 64]);
    expect(grid.cells).toBe(64);
  });

  it('falls back on the zoom with no projection', () => {
    const grid = gridOnScreen(corners, { zoom: 2 });
    expect(new Set(grid.sides)).toEqual(new Set([grid.cells]));
  });
});

describe('drapedMesh', () => {
  const corners = cornersOf([-1, -1, 1, 1])!;

  it('puts every vertex at the ground under it', () => {
    const mesh = drapedMesh(corners, 4, (lng, lat) => 100 * lng + lat);
    expect(mesh.positions.length).toBe(25 * 3);
    for (let i = 0; i < 25; i++) {
      const [lng, lat, z] = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
      expect(z).toBeCloseTo(100 * lng + lat, 9);
    }
  });

  it('spaces the rows evenly in Web Mercator, so a Mercator picture keeps its texture', () => {
    const tall = cornersOf([0, 0, 1, 80])!;
    const mesh = drapedMesh(tall, 2, () => 0);
    expect(mesh.positions[1]).toBeCloseTo(0, 9);
    expect(mesh.positions[3 * 2 + 1]).toBeCloseTo(80, 6);
    expect(mesh.positions[3 + 1]).toBeGreaterThan(55);
    expect(mesh.texCoords[2 + 1]).toBeCloseTo(0.5, 9);
  });

  it('has deck’s texture coordinates at the corners and two triangles per cell', () => {
    const mesh = drapedMesh(corners, 1, () => 0);
    expect(Array.from(mesh.texCoords)).toEqual([0, 1, 0, 0, 1, 1, 1, 0]);
    expect(mesh.vertexCount).toBe(6);
    expect(Array.from(mesh.indices)).toEqual([1, 0, 2, 1, 2, 3]);
  });

  it('puts a side cut in fewer cells on the straight line between its cuts, as the tile beyond draws it', () => {
    // A ridge across the middle; the bottom side (corner 3 to 0) in 2 cells, the rest in 4.
    const ridge = (lng: number) => (Math.abs(lng) < 0.3 ? 100 : 0);
    const mesh = drapedMesh(corners, { cells: 4, sides: [4, 4, 4, 2] }, ridge);
    const z = (u: number, v: number) => mesh.positions[(u * 5 + v) * 3 + 2];
    // Bottom row (v = 0): cuts at u = 0, 2, 4 keep the ground; u = 1 and 3 lie between.
    expect([0, 1, 2, 3, 4].map((u) => z(u, 0))).toEqual([0, 50, 100, 50, 0]);
    // The top row, cut in 4, follows the ground.
    expect([0, 1, 2, 3, 4].map((u) => z(u, 4))).toEqual([0, 0, 100, 0, 0]);
  });

  it('counts a missing height as 0', () => {
    const mesh = drapedMesh(corners, 1, () => Number.NaN);
    expect(Array.from(mesh.positions.slice(0, 12)).filter((_, i) => i % 3 === 2)).toEqual([0, 0, 0, 0]);
  });
});

describe('reliefDrapeOf', () => {
  it('is the same object for the same lookup, and a new one for a new lookup', () => {
    const lookup = { version: 1, elevationAt: () => 0 };
    expect(reliefDrapeOf(lookup)).toBe(reliefDrapeOf({ ...lookup }));
    expect(reliefDrapeOf({ version: 2, elevationAt: () => 0 })).not.toBe(reliefDrapeOf(lookup));
  });
});

describe('ReliefDrapeExtension', () => {
  interface FakeBitmap {
    props: Record<string, unknown>;
    state: Record<string, unknown>;
    context: { viewport: { zoom: number } };
    invalidated: string[];
    setState(state: Record<string, unknown>): void;
    getAttributeManager(): { invalidate(name: string): void };
    _createMesh(): unknown;
  }

  function bitmap(props: Record<string, unknown>): FakeBitmap {
    const layer = Object.create(BitmapLayer.prototype) as FakeBitmap;
    const flat = { vertexCount: 6, flat: true };
    let count = 0;
    Object.assign(layer, {
      props: { bounds: [-1, -1, 1, 1], ...props },
      state: { mesh: flat, model: { setVertexCount: (n: number) => (count = n) } },
      context: { viewport: { zoom: 2 } },
      invalidated: [] as string[],
    });
    layer.setState = (state) => Object.assign(layer.state, state);
    layer.getAttributeManager = () => ({ invalidate: (name: string) => layer.invalidated.push(name) });
    layer._createMesh = () => flat;
    Object.defineProperty(layer, 'count', { get: () => count });
    return layer;
  }

  it('gives a bitmap on the relief its grid, and the flat mesh back off it', () => {
    const drape = reliefDrapeOf({ version: 1, elevationAt: () => 3000 });
    const layer = bitmap({ reliefDrape: drape });
    RELIEF_DRAPE.updateState.call(layer as never);
    const mesh = layer.state.mesh as { positions: Float64Array; vertexCount: number };
    expect(mesh.positions[2]).toBe(3000);
    expect((layer as unknown as { count: number }).count).toBe(mesh.vertexCount);
    expect(layer.invalidated).toEqual(['positions', 'texCoords', 'indices']);

    layer.props.reliefDrape = null;
    RELIEF_DRAPE.updateState.call(layer as never);
    expect(layer.state.mesh).toEqual({ vertexCount: 6, flat: true });
  });

  it('reuses the grid of the same bounds on the same relief', () => {
    const drape = reliefDrapeOf({ version: 3, elevationAt: () => 1 });
    const a = bitmap({ reliefDrape: drape });
    const b = bitmap({ reliefDrape: drape, bounds: [-1, -1, 1, 1] });
    RELIEF_DRAPE.updateState.call(a as never);
    RELIEF_DRAPE.updateState.call(b as never);
    expect(b.state.mesh).toBe(a.state.mesh);
  });

  it('leaves other layers alone', () => {
    const other = { props: { reliefDrape: reliefDrapeOf({ version: 4, elevationAt: () => 1 }) }, state: {} };
    expect(() => RELIEF_DRAPE.updateState.call(other as never)).not.toThrow();
    expect(other.state).toEqual({});
  });
});

describe('drapeSampler', () => {
  class FakeLngLat {
    constructor(
      public lng: number,
      public lat: number
    ) {}
  }

  it('reads each point off the sampler of the elevation tile under it, exaggerated, asking once per tile', () => {
    const asked: string[] = [];
    const terrain = {
      exaggeration: 1.5,
      _getOverscaledTileIDFromLngLatZoom: (ll: FakeLngLat, z: number) => {
        const n = 2 ** z;
        return { tileID: `${z}/${Math.floor(((ll.lng + 180) / 360) * n)}` };
      },
      getElevationSampler: (tileID: string) => {
        asked.push(tileID);
        return (x: number, y: number, extent: number) => (x / extent) * 100;
      },
    };
    const map = { terrain, getZoom: () => 1.7, getCenter: () => new FakeLngLat(0, 0) };
    const at = drapeSampler(map, () => -1);
    // Zoom 1: two tiles across. 90°W is half way across the western one.
    expect(at(-90, 10)).toBeCloseTo(75, 6);
    expect(at(-45, -10)).toBeCloseTo(112.5, 6);
    expect(at(90, 0)).toBeCloseTo(75, 6);
    expect(asked).toEqual(['1/0', '1/0', '1/1']);
  });

  it('is 0 where no elevation tile is loaded, and the fallback with no MapLibre internals', () => {
    const terrain = { _getOverscaledTileIDFromLngLatZoom: () => ({ tileID: 'x' }), getElevationSampler: () => null };
    const map = { terrain, getZoom: () => 3, getCenter: () => new FakeLngLat(0, 0) };
    expect(drapeSampler(map, () => -1)(1, 1)).toBe(0);
    expect(drapeSampler({ terrain: {}, getZoom: () => 3 }, () => -1)(1, 1)).toBe(-1);
    expect(drapeSampler({ terrain: null, getZoom: () => 3 }, () => -1)(1, 1)).toBe(0);
  });
});
