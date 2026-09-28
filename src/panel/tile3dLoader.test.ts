import { enclosingBox, regionBox, sturdyLoader } from './tile3dLoader';

/** Cesium OSM Buildings' root (ion asset 96188), as served on 2026-09-28: a region round the whole world. */
const OSM_BUILDINGS_REGION = [
  -3.1415925942485985, -1.4712182366024542, 3.141545370875028, 1.4502639200680947, -394.3409143207921,
  5967.300616082603,
];

/** A few blocks of central Cuenca, in radians: well under a degree either way. */
const CUENCA_REGION = [-1.37916, -0.05066, -1.37846, -0.05036, 2490, 2610];

/** The glTF of OSM Buildings' `root.b3dm`, once loaders.gl has parsed it: valid, and with nothing to draw. */
function emptyGltf(): Record<string, unknown> {
  return { asset: { version: '2.0' }, nodes: [{}], scenes: [{ nodes: [0] }], scene: 0 };
}

type Parsed = Record<string, any>;

function fakeLoader(id: string, parsed: () => Parsed, preloaded?: Parsed) {
  return {
    id,
    name: id,
    extensions: ['json', 'b3dm'],
    options: { [id]: { isTileset: 'auto' } },
    parse: jest.fn(async (_data: ArrayBuffer, _options?: unknown, _context?: unknown): Promise<Parsed> => parsed()),
    ...(preloaded ? { preload: jest.fn(async (_url: string, _options?: unknown): Promise<Parsed> => preloaded) } : {}),
  };
}

/** WGS 84, geodetic to ECEF: the reference the enclosing box is checked against. */
function ecef(longitude: number, latitude: number, height: number): number[] {
  const a = 6378137;
  const e2 = 6.69437999014e-3;
  const n = a / Math.sqrt(1 - e2 * Math.sin(latitude) ** 2);
  return [
    (n + height) * Math.cos(latitude) * Math.cos(longitude),
    (n + height) * Math.cos(latitude) * Math.sin(longitude),
    (n * (1 - e2) + height) * Math.sin(latitude),
  ];
}

function inside(box: number[], point: number[]): boolean {
  // The boxes built here are axis-aligned: each half-axis lies along one ECEF axis.
  const halves = [box[3], box[7], box[11]];
  return point.every((value, axis) => Math.abs(value - box[axis]) <= halves[axis]);
}

/** Points all over a region, at every height it allows, between the grid the box was built from. */
function pointsOf(region: number[], count = 4000): number[][] {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const east = region[2] < region[0] ? region[2] + 2 * Math.PI : region[2];
  return Array.from({ length: count }, () =>
    ecef(
      region[0] + random() * (east - region[0]),
      region[1] + random() * (region[3] - region[1]),
      region[4] + random() * (region[5] - region[4])
    )
  );
}

describe('enclosingBox', () => {
  it('holds every point of the whole world, at every height the region allows', () => {
    const box = enclosingBox(OSM_BUILDINGS_REGION);
    expect(pointsOf(OSM_BUILDINGS_REGION).every((point) => inside(box, point))).toBe(true);
  });

  it('holds every point of a wide region that crosses the antimeridian', () => {
    const pacific = [2.6, -0.8, -2.4, -0.1, -8000, 4000];
    const box = enclosingBox(pacific);
    expect(pointsOf(pacific).every((point) => inside(box, point))).toBe(true);
  });

  it('stays close round what it holds', () => {
    // A box loose by thousands of kilometres would make every tile look near,
    // and the traversal would load all of them.
    const quadrant = [-1.6, -0.8, 0, 0.8, 0, 1000];
    const box = enclosingBox(quadrant);
    const points = pointsOf(quadrant, 20000);
    [0, 1, 2].forEach((axis) => {
      const values = points.map((point) => point[axis]);
      const reach = (Math.max(...values) - Math.min(...values)) / 2;
      expect(box[3 + axis * 4]).toBeLessThan(reach + 60_000);
    });
  });
});

/** Whether a box `[centre, halfAxes×3]`, oriented any way, holds a point. */
function insideOriented(box: number[], point: number[]): boolean {
  const offset = [0, 1, 2].map((axis) => point[axis] - box[axis]);
  return [0, 1, 2].every((i) => {
    const u = box.slice(3 + i * 3, 6 + i * 3);
    const length2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    return Math.abs(offset[0] * u[0] + offset[1] * u[1] + offset[2] * u[2]) <= length2 * (1 + 1e-9);
  });
}

describe('regionBox', () => {
  it('gives a city-sized region a box along its own east, north and up that holds all of it', () => {
    // A box follows the tileset's model matrix and a region does not: grounding
    // moved the buildings of a region tileset down to the map, and loaders.gl
    // still culled them where they had been, above a street-level camera.
    const box = regionBox(CUENCA_REGION);
    expect(pointsOf(CUENCA_REGION).every((point) => insideOriented(box, point))).toBe(true);
  });

  it('keeps a city-sized region’s box close round it', () => {
    const box = regionBox(CUENCA_REGION);
    const [east, north, up] = [0, 1, 2].map((i) => Math.hypot(...box.slice(3 + i * 3, 6 + i * 3)));
    // 0.0007 rad of longitude and 0.0003 of latitude at the equator, 120 m of heights.
    expect(east).toBeLessThan(2300);
    expect(north).toBeLessThan(1000);
    expect(up).toBeLessThan(65);
  });

  it('holds every point of a thin region stretched along a parallel, wherever it lies', () => {
    // Along a parallel the surface drifts poleward of the centre's own east:
    // by 97 m across 0.9° at 45°N, which a north half-axis of the region's own
    // height missed altogether.
    const degrees = (value: number) => (value * Math.PI) / 180;
    for (const latitude of [45, 60, -45]) {
      const thin = [degrees(-0.45), degrees(latitude), degrees(0.45), degrees(latitude + 0.001), 0, 50];
      const box = regionBox(thin);
      const outside = pointsOf(thin, 20000).filter((point) => !insideOriented(box, point));
      expect(outside).toEqual([]);
      // And no looser than it has to be: 111 m of latitude plus the drift north, 50 m of heights plus the curve.
      const [, northHalf, upHalf] = [0, 1, 2].map((i) => Math.hypot(...box.slice(3 + i * 3, 6 + i * 3)));
      expect(northHalf).toBeLessThan(120);
      expect(upHalf).toBeLessThan(100);
    }
  });

  it('holds every point of a region under a degree reaching across the antimeridian', () => {
    const fiji = [Math.PI - 0.005, -0.3, -Math.PI + 0.004, -0.296, -20, 1300];
    const box = regionBox(fiji);
    expect(pointsOf(fiji, 20000).every((point) => insideOriented(box, point))).toBe(true);
  });

  it('boxes a wide region as a whole', () => {
    expect(regionBox(OSM_BUILDINGS_REGION)).toEqual(enclosingBox(OSM_BUILDINGS_REGION));
  });
});

describe('sturdyLoader', () => {
  it('hands back the same wrapper for the same loader, and does not wrap a wrapper', () => {
    // deck compares its props by identity: a new loader on every render would
    // tear the tileset down and download it again.
    const loader = fakeLoader('3d-tiles', () => ({}));
    expect(sturdyLoader(loader)).toBe(sturdyLoader(loader));
    expect(sturdyLoader(sturdyLoader(loader))).toBe(sturdyLoader(loader));
  });

  it('keeps the loader’s id, which is how loaders.gl finds its options', () => {
    const wrapped = sturdyLoader(fakeLoader('cesium-ion', () => ({})));
    expect(wrapped.id).toBe('cesium-ion');
    expect(wrapped.options).toEqual({ 'cesium-ion': { isTileset: 'auto' } });
  });

  it('leaves alone a loader that is not for 3D Tiles', () => {
    const i3s = fakeLoader('i3s', () => ({}));
    expect(sturdyLoader(i3s)).toBe(i3s);
    expect(sturdyLoader(undefined)).toBeUndefined();
  });

  describe('a tileset it parses', () => {
    it('names itself as the loader of every tile below', () => {
      // loaders.gl writes its own Tiles3DLoader there, and Tileset3D loads every
      // tile and nested tileset with it: without this, nothing below the root
      // would be mended.
      const tiles3d = fakeLoader('3d-tiles', () => ({}));
      const ion = fakeLoader('cesium-ion', () => ({ shape: 'tileset3d', loader: tiles3d, root: {} }));
      return sturdyLoader(ion)
        .parse(new ArrayBuffer(0), {}, {})
        .then((tileset: Parsed) => expect(tileset.loader).toBe(sturdyLoader(tiles3d)));
    });

    it('boxes a region round the whole world, and keeps the region for the ground height', async () => {
      const loader = fakeLoader('3d-tiles', () => ({
        shape: 'tileset3d',
        root: { boundingVolume: { region: [...OSM_BUILDINGS_REGION] }, children: [] },
      }));
      const tileset = await sturdyLoader(loader).parse(new ArrayBuffer(0), {}, {});

      // loaders.gl reads a box before a region, and builds a region's box from
      // two opposite corners — the same meridian, for a region all the way round.
      expect(tileset.root.boundingVolume.box).toEqual(enclosingBox(OSM_BUILDINGS_REGION));
      expect(tileset.root.boundingVolume.region).toEqual(OSM_BUILDINGS_REGION);
    });

    it('boxes the regions of the tiles below as well, small ones included', async () => {
      const hemisphere = [-Math.PI, -1.47, 0, 1.45, -394, 5967];
      const loader = fakeLoader('3d-tiles', () => ({
        shape: 'tileset3d',
        root: {
          boundingVolume: { region: [...OSM_BUILDINGS_REGION] },
          children: [
            {
              boundingVolume: { region: [...hemisphere] },
              children: [{ boundingVolume: { region: [...CUENCA_REGION] } }],
            },
          ],
        },
      }));
      const tileset = await sturdyLoader(loader).parse(new ArrayBuffer(0), {}, {});
      const [west] = tileset.root.children;

      expect(west.boundingVolume.box).toEqual(enclosingBox(hemisphere));
      expect(west.children[0].boundingVolume).toEqual({ region: CUENCA_REGION, box: regionBox(CUENCA_REGION) });
    });

    it('leaves a region under a transform alone', () => {
      // A box is moved by the tile's transform, a region never is: boxing one
      // under a transform would move it.
      const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1];
      const loader = fakeLoader('3d-tiles', () => ({
        shape: 'tileset3d',
        root: {
          transform,
          boundingVolume: { region: [...OSM_BUILDINGS_REGION] },
          children: [{ boundingVolume: { region: [...OSM_BUILDINGS_REGION] } }],
        },
      }));
      return sturdyLoader(loader)
        .parse(new ArrayBuffer(0), {}, {})
        .then((tileset: Parsed) => {
          expect(tileset.root.boundingVolume).toEqual({ region: OSM_BUILDINGS_REGION });
          expect(tileset.root.children[0].boundingVolume).toEqual({ region: OSM_BUILDINGS_REGION });
        });
    });
  });

  describe('a tile it parses', () => {
    it('gives a glTF with nothing to draw an empty list of meshes', async () => {
      // luma.gl walks `gltf.meshes` without asking whether there are any, throws,
      // and deck switches the whole layer off: OSM Buildings' very first tile.
      const loader = fakeLoader('3d-tiles', () => ({ type: 'b3dm', gltf: emptyGltf() }));
      const tile = await sturdyLoader(loader).parse(new ArrayBuffer(0), {}, {});
      expect(tile.gltf.meshes).toEqual([]);
    });

    it('fills in the meshes of a glTF that luma.gl has still to process', async () => {
      const loader = fakeLoader('3d-tiles', () => ({ type: 'glTF', gltf: { json: emptyGltf(), buffers: [] } }));
      const tile = await sturdyLoader(loader).parse(new ArrayBuffer(0), {}, {});
      expect(tile.gltf.json.meshes).toEqual([]);
    });

    it('gives a glTF with no nodes an empty list, and one with no scenes an empty scene to show', async () => {
      // An empty list of scenes would leave deck's ScenegraphLayer with no
      // scene to draw: the tile would never count as drawn, and loaders.gl
      // would hold the tiles it replaces, traversing again for ever.
      const bare = { asset: { version: '2.0' } };
      const filled = { ...bare, meshes: [], nodes: [], scenes: [{ nodes: [] }], scene: 0 };
      const processed = await sturdyLoader(fakeLoader('3d-tiles', () => ({ gltf: { ...bare } }))).parse(
        new ArrayBuffer(0),
        {},
        {}
      );
      expect(processed.gltf).toEqual(filled);

      const raw = await sturdyLoader(fakeLoader('3d-tiles', () => ({ gltf: { json: { ...bare } } }))).parse(
        new ArrayBuffer(0),
        {},
        {}
      );
      expect(raw.gltf.json).toEqual(filled);
    });

    it('keeps the scenes a glTF has, and the scene it names', async () => {
      const scenes = [{ nodes: [0] }, { nodes: [1] }];
      const gltf = { asset: { version: '2.0' }, nodes: [{}, {}], scenes, scene: 1 };
      const parsed = await sturdyLoader(fakeLoader('3d-tiles', () => ({ gltf: { ...gltf } }))).parse(
        new ArrayBuffer(0),
        {},
        {}
      );
      expect(parsed.gltf.scenes).toBe(scenes);
      expect(parsed.gltf.scene).toBe(1);
    });

    it('leaves a glTF with meshes, and a tile with no glTF, as they were', async () => {
      const meshes = [{ primitives: [] }];
      const withMeshes = await sturdyLoader(fakeLoader('3d-tiles', () => ({ gltf: { ...emptyGltf(), meshes } }))).parse(
        new ArrayBuffer(0),
        {},
        {}
      );
      expect(withMeshes.gltf.meshes).toBe(meshes);

      const points = await sturdyLoader(fakeLoader('3d-tiles', () => ({ type: 'pnts', pointCount: 3 }))).parse(
        new ArrayBuffer(0),
        {},
        {}
      );
      expect(points).toEqual({ type: 'pnts', pointCount: 3 });
    });
  });

  describe('an ion asset it preloads', () => {
    it('follows an asset ion serves from elsewhere, and keeps the ion token away from it', async () => {
      // Google Photorealistic 3D Tiles through ion (asset 2275207): ion answers
      // with Google's own URL, under `options`. loaders.gl reads it there but hands
      // deck no `url`, so deck asked ion's URL instead and got a 401.
      const ion = fakeLoader('cesium-ion', () => ({}), {
        type: '3DTILES',
        externalType: '3DTILES',
        options: { url: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=cesium-google-key' },
        headers: { Authorization: 'Bearer ion-token' },
      });
      const preloaded = await sturdyLoader(ion).preload!('https://assets.ion.cesium.com/2275207/tileset.json', {});

      expect(preloaded.url).toBe('https://tile.googleapis.com/v1/3dtiles/root.json?key=cesium-google-key');
      expect(preloaded.headers).toBeUndefined();
    });

    it('leaves an asset ion serves itself as ion described it', async () => {
      const described = {
        type: '3DTILES',
        url: 'https://assets.ion.cesium.com/us-east-1/asset_depot/96188/OpenStreetMap/CWT/2026-06-08/tileset.json?v=20',
        headers: { Authorization: 'Bearer short-lived' },
      };
      const ion = fakeLoader('cesium-ion', () => ({}), described);
      const preloaded = await sturdyLoader(ion).preload!('https://assets.ion.cesium.com/96188/tileset.json', {});
      expect(preloaded).toEqual(described);
    });

    it('reads the URL ion serves the asset from where loaders.gl does: under options first', async () => {
      const ion = fakeLoader('cesium-ion', () => ({}), {
        type: '3DTILES',
        url: 'https://assets.ion.cesium.com/2275207/tileset.json',
        options: { url: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=k' },
        headers: { Authorization: 'Bearer ion-token' },
      });
      const preloaded = await sturdyLoader(ion).preload!('https://assets.ion.cesium.com/2275207/tileset.json', {});
      expect(preloaded.url).toBe('https://tile.googleapis.com/v1/3dtiles/root.json?key=k');
      expect(preloaded.headers).toBeUndefined();
    });

    it('keeps the ion token from hosts that only look like ion’s, and from ion over plain http', async () => {
      for (const url of [
        'https://cesium.com.evil.com/tileset.json',
        'https://evilcesium.com/tileset.json',
        'http://assets.ion.cesium.com/96188/tileset.json',
      ]) {
        const ion = fakeLoader('cesium-ion', () => ({}), {
          type: '3DTILES',
          url,
          headers: { Authorization: 'Bearer ion-token' },
        });
        const preloaded = await sturdyLoader(ion).preload!('https://assets.ion.cesium.com/96188/tileset.json', {});
        expect(preloaded.url).toBe(url);
        expect(preloaded.headers).toBeUndefined();
      }
    });

    it('adds no preload to a loader that had none', () => {
      expect('preload' in sturdyLoader(fakeLoader('3d-tiles', () => ({})))).toBe(false);
    });
  });
});
