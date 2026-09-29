import type { Page } from '@playwright/test';

/**
 * 3D Tiles shaped like the real ones that drew nothing on 2026-09-28, served
 * from a stubbed host so the suite still makes no outbound call.
 *
 * - `world-regions/`: Cesium OSM Buildings' shape. A region round the whole
 *   world, whose first tile is a b3dm with a glTF that has no meshes, then a
 *   nested tileset for the western hemisphere, then a few blocks of Cuenca at
 *   2 490 m — and, beside them, a coarse tile whose one building lies far from
 *   its centre, the way OSM Buildings keeps Cuenca's stadium (see
 *   {@link FAR_BUILDING}).
 * - `world-buildings/`: Cesium OSM Buildings' buildings. The same world, and
 *   under it one tile of two batched buildings standing on the ground at
 *   different heights, the way OSM Buildings places each on the terrain
 *   ({@link HILL_BUILDINGS}).
 * - `world-box/`: Google Photorealistic 3D Tiles' shape. A cube centred on the
 *   centre of the Earth, then a small box over Cuenca.
 * - An ion asset (424242) whose endpoint answers with a URL elsewhere, the way
 *   ion serves Google's 3D Tiles: `elsewhere/` serves the box world again.
 */
export const TILES3D_HOST = 'https://tiles3d.kepler-grafana.test';
export const ION_ASSET = 424242;
export const ION_TOKEN = 'e2e-ion-token';
export const ELSEWHERE_URL = `${TILES3D_HOST}/elsewhere/root.json?key=e2e-elsewhere-key`;

/** Parque Calderón, Cuenca: where every panel of the board looks, 2 550 m up. */
export const CUENCA = { longitude: -79.0045, latitude: -2.8975 };

/** Cesium OSM Buildings' root region as served on 2026-09-28. */
const WORLD = [
  -3.1415925942485985, -1.4712182366024542, 3.141545370875028, 1.4502639200680947, -394.3409143207921,
  5967.300616082603,
];
const WEST = [-Math.PI, WORLD[1], 0, WORLD[3], -165, WORLD[5]];

/** The blocks' lowest point, which the ground under the view should come to. */
export const CITY_REGION_GROUND = 2490;

/**
 * A building far from the centre of the tile it comes in, the way Cesium OSM
 * Buildings keeps large buildings in coarse tiles (ADD refinement): Cuenca's
 * stadium lies 9.9 km east and 27.9 km north of the centre of its tile. Here the
 * building is Parque Calderón, 2 500 m up, and the tile a region round Cuenca
 * centred that far south-west of it; the b3dm places its one triangle there
 * with `RTC_CENTER`, so it lies ~29 km from the origin deck draws the tile round.
 */
export const FAR_BUILDING = { east: 9_900, north: 27_900, height: 2_500 };

/**
 * Two buildings a few hundred metres apart, each at the altitude of its own
 * base, as Cesium OSM Buildings places them from Cesium World Terrain: one on
 * Parque Calderón at 2 490 m, one on a hill at 2 700 m. `east` and `north` are
 * metres from Parque Calderón to the building's south-west corner.
 */
export const HILL_BUILDINGS = [
  { east: 0, north: 0, base: 2490, height: 20 },
  { east: 250, north: 300, base: 2700, height: 30 },
];

/** The height at which the vertical under the view enters the box world's city tile. */
export const CITY_BOX_GROUND = 2400;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function cityRegion(): number[] {
  const { longitude, latitude } = CUENCA;
  return [
    radians(longitude - 0.02),
    radians(latitude - 0.02),
    radians(longitude + 0.02),
    radians(latitude + 0.02),
    CITY_REGION_GROUND,
    2610,
  ];
}

/** WGS 84, geodetic (radians, metres) to ECEF. */
function ecef(longitude: number, latitude: number, height: number): number[] {
  const e2 = 6.69437999014e-3;
  const n = 6378137 / Math.sqrt(1 - e2 * Math.sin(latitude) ** 2);
  return [
    (n + height) * Math.cos(latitude) * Math.cos(longitude),
    (n + height) * Math.cos(latitude) * Math.sin(longitude),
    (n * (1 - e2) + height) * Math.sin(latitude),
  ];
}

/** Metres per degree of latitude near the equator, and of longitude on it: near enough to lay out a region. */
const METRES_PER_DEGREE_NORTH = 110_576;
const METRES_PER_DEGREE_EAST = 111_320;

/** The region of the tile {@link FAR_BUILDING} comes in: centred that far south-west of it, and reaching past it. */
function farRegion(): number[] {
  const { longitude, latitude } = CUENCA;
  const centreLatitude = latitude - FAR_BUILDING.north / METRES_PER_DEGREE_NORTH;
  const centreLongitude = longitude - FAR_BUILDING.east / (METRES_PER_DEGREE_EAST * Math.cos(radians(latitude)));
  return [
    radians(centreLongitude - 0.1),
    radians(centreLatitude - 0.26),
    radians(centreLongitude + 0.1),
    radians(centreLatitude + 0.26),
    CITY_REGION_GROUND,
    2610,
  ];
}

/** The region of the tile the buildings come in: a few blocks round them, from the lower base to the taller top. */
function buildingsRegion(): number[] {
  const { longitude, latitude } = CUENCA;
  return [
    radians(longitude - 0.01),
    radians(latitude - 0.01),
    radians(longitude + 0.01),
    radians(latitude + 0.01),
    Math.min(...HILL_BUILDINGS.map(({ base }) => base)),
    Math.max(...HILL_BUILDINGS.map(({ base, height }) => base + height)),
  ];
}

/** A box the way Google writes a small tile: ECEF, with half-axes along the local east, north and up. */
function cityBox(): number[] {
  const lon = radians(CUENCA.longitude);
  const lat = radians(CUENCA.latitude);
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const halfUp = 150;
  return [
    ...ecef(lon, lat, CITY_BOX_GROUND + halfUp),
    ...east.map((v) => v * 2000),
    ...north.map((v) => v * 2000),
    ...up.map((v) => v * halfUp),
  ];
}

function glb(json: Record<string, unknown>, bin = Buffer.alloc(0)): Buffer {
  const pad = (data: Buffer, fill: number) => Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4, fill)]);
  const chunk = (data: Buffer, type: number) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(data.length, 0);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, data]);
  };
  const chunks = [chunk(pad(Buffer.from(JSON.stringify(json)), 0x20), 0x4e4f534a)];
  if (bin.length) {
    chunks.push(chunk(pad(bin, 0), 0x004e4942));
  }
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + chunks.reduce((total, part) => total + part.length, 0), 8);
  return Buffer.concat([header, ...chunks]);
}

/** One triangle: something to draw. */
function triangleGlb(): Buffer {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  return glb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    },
    positions
  );
}

/** Where the buildings' glb is centred, `RTC_CENTER`: over Parque Calderón, 2 600 m up. */
function buildingsCentre(): number[] {
  return ecef(radians(CUENCA.longitude), radians(CUENCA.latitude), 2600);
}

/**
 * The buildings as ion's tiler writes them: one glb, Y up round `RTC_CENTER`,
 * one box of 20 m by 20 m per building, each vertex tagged with its
 * building's `_BATCHID`.
 */
function buildingsGlb(): Buffer {
  const centre = buildingsCentre();
  const positions: number[] = [];
  const ids: number[] = [];
  const indices: number[] = [];
  // A box's six faces, as the corners below number them: bottom 0-3, top 4-7, each anticlockwise from south-west.
  const faces = [
    [0, 2, 1, 0, 3, 2],
    [4, 5, 6, 4, 6, 7],
    [0, 1, 5, 0, 5, 4],
    [1, 2, 6, 1, 6, 5],
    [2, 3, 7, 2, 7, 6],
    [3, 0, 4, 3, 4, 7],
  ];
  HILL_BUILDINGS.forEach(({ east, north, base, height }, id) => {
    const first = positions.length / 3;
    for (const up of [0, height]) {
      for (const [e, n] of [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ]) {
        const latitude = CUENCA.latitude + (north + n) / METRES_PER_DEGREE_NORTH;
        const longitude = CUENCA.longitude + (east + e) / (METRES_PER_DEGREE_EAST * Math.cos(radians(CUENCA.latitude)));
        const corner = ecef(radians(longitude), radians(latitude), base + up);
        const [x, y, z] = [0, 1, 2].map((axis) => corner[axis] - centre[axis]);
        // ECEF offset to glTF's Y up: loaders.gl turns it back with a quarter turn about x.
        positions.push(x, z, -y);
        ids.push(id);
      }
    }
    faces.flat().forEach((index) => indices.push(first + index));
  });

  const positionBytes = Buffer.alloc(positions.length * 4);
  positions.forEach((value, i) => positionBytes.writeFloatLE(value, i * 4));
  const idBytes = Buffer.alloc(ids.length * 4);
  ids.forEach((value, i) => idBytes.writeFloatLE(value, i * 4));
  const indexBytes = Buffer.alloc(indices.length * 2);
  indices.forEach((value, i) => indexBytes.writeUInt16LE(value, i * 2));
  const count = positions.length / 3;
  const low = [0, 1, 2].map((axis) => Math.min(...positions.filter((_, i) => i % 3 === axis)));
  const high = [0, 1, 2].map((axis) => Math.max(...positions.filter((_, i) => i % 3 === axis)));
  return glb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, _BATCHID: 1 }, indices: 2 }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: low, max: high },
        { bufferView: 1, componentType: 5126, count, type: 'SCALAR' },
        { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
        { buffer: 0, byteOffset: positionBytes.length, byteLength: idBytes.length },
        { buffer: 0, byteOffset: positionBytes.length + idBytes.length, byteLength: indexBytes.length },
      ],
      buffers: [{ byteLength: positionBytes.length + idBytes.length + indexBytes.length }],
    },
    Buffer.concat([positionBytes, idBytes, indexBytes])
  );
}

/** A valid glTF with nothing to draw: no `meshes` at all, like OSM Buildings' `root.b3dm`. */
function emptyGlb(): Buffer {
  return glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{}] });
}

/**
 * A batched 3D model wrapping a glb, with an empty batch unless told how many
 * features it holds; `rtcCenter` places the glb's origin in ECEF, as ion's
 * tiler does.
 */
function b3dm(content: Buffer, rtcCenter?: number[], batchLength = 0): Buffer {
  // The glb has to start on an 8-byte boundary: the 28-byte header plus this JSON.
  let featureTable = Buffer.from(
    JSON.stringify({ BATCH_LENGTH: batchLength, ...(rtcCenter ? { RTC_CENTER: rtcCenter } : {}) })
  );
  featureTable = Buffer.concat([featureTable, Buffer.alloc((8 - ((28 + featureTable.length) % 8)) % 8, 0x20)]);
  const header = Buffer.alloc(28);
  header.write('b3dm', 0, 'ascii');
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(28 + featureTable.length + content.length, 8);
  header.writeUInt32LE(featureTable.length, 12);
  return Buffer.concat([header, featureTable, content]);
}

const REGION_WORLD = {
  asset: { version: '1.0' },
  geometricError: 77067,
  root: {
    boundingVolume: { region: WORLD },
    geometricError: 77067,
    refine: 'ADD',
    content: { uri: 'root.b3dm' },
    children: [
      { boundingVolume: { region: WEST }, geometricError: 38000, refine: 'ADD', content: { uri: 'west.json' } },
    ],
  },
};

const REGION_WEST = {
  asset: { version: '1.0' },
  geometricError: 38000,
  root: {
    boundingVolume: { region: WEST },
    geometricError: 38000,
    refine: 'ADD',
    children: [
      { boundingVolume: { region: cityRegion() }, geometricError: 0, refine: 'ADD', content: { uri: 'city.b3dm' } },
      { boundingVolume: { region: farRegion() }, geometricError: 0, refine: 'ADD', content: { uri: 'far.b3dm' } },
    ],
  },
};

const BUILDINGS_WORLD = {
  asset: { version: '1.0' },
  geometricError: 77067,
  root: {
    boundingVolume: { region: WORLD },
    geometricError: 77067,
    refine: 'ADD',
    content: { uri: 'root.b3dm' },
    children: [
      {
        boundingVolume: { region: buildingsRegion() },
        geometricError: 0,
        refine: 'ADD',
        content: { uri: 'blocks.b3dm' },
      },
    ],
  },
};

const BOX_WORLD = {
  asset: { version: '1.0' },
  geometricError: 1e7,
  root: {
    boundingVolume: { box: [0, 0, 0, 7645212, 0, 0, 0, 7645212, 0, 0, 0, 7645212] },
    geometricError: 1e7,
    refine: 'REPLACE',
    children: [
      { boundingVolume: { box: cityBox() }, geometricError: 0, refine: 'REPLACE', content: { uri: 'city.glb' } },
    ],
  },
};

/** A request the stubs answered: its path on the stubbed host (or its URL elsewhere), query, and credentials. */
export interface Tiles3dRequest {
  url: string;
  path: string;
  query: string;
  authorization?: string;
}

/**
 * Serves every tileset of the board, and ion's REST API for the one asset.
 * Returns the requests as they arrive.
 */
export async function routeTiles3d(page: Page): Promise<Tiles3dRequest[]> {
  const requests: Tiles3dRequest[] = [];
  const record = (url: string, authorization?: string) => {
    const parsed = new URL(url);
    requests.push({ url, path: parsed.pathname, query: parsed.search, authorization });
  };
  const bodies: Record<string, () => { body: Buffer | string; contentType: string }> = {
    '/world-regions/tileset.json': () => ({ body: JSON.stringify(REGION_WORLD), contentType: 'application/json' }),
    '/world-regions/west.json': () => ({ body: JSON.stringify(REGION_WEST), contentType: 'application/json' }),
    '/world-regions/root.b3dm': () => ({ body: b3dm(emptyGlb()), contentType: 'application/octet-stream' }),
    '/world-regions/city.b3dm': () => ({ body: b3dm(triangleGlb()), contentType: 'application/octet-stream' }),
    '/world-regions/far.b3dm': () => ({
      body: b3dm(triangleGlb(), ecef(radians(CUENCA.longitude), radians(CUENCA.latitude), FAR_BUILDING.height)),
      contentType: 'application/octet-stream',
    }),
    '/world-buildings/tileset.json': () => ({ body: JSON.stringify(BUILDINGS_WORLD), contentType: 'application/json' }),
    '/world-buildings/root.b3dm': () => ({ body: b3dm(emptyGlb()), contentType: 'application/octet-stream' }),
    '/world-buildings/blocks.b3dm': () => ({
      body: b3dm(buildingsGlb(), buildingsCentre(), HILL_BUILDINGS.length),
      contentType: 'application/octet-stream',
    }),
    '/world-box/root.json': () => ({ body: JSON.stringify(BOX_WORLD), contentType: 'application/json' }),
    '/world-box/city.glb': () => ({ body: triangleGlb(), contentType: 'model/gltf-binary' }),
    '/elsewhere/root.json': () => ({ body: JSON.stringify(BOX_WORLD), contentType: 'application/json' }),
    '/elsewhere/city.glb': () => ({ body: triangleGlb(), contentType: 'model/gltf-binary' }),
  };
  await page.route(`${TILES3D_HOST}/**`, (route) => {
    const request = route.request();
    record(request.url(), request.headers()['authorization']);
    const answer = bodies[new URL(request.url()).pathname];
    return answer ? route.fulfill({ status: 200, ...answer() }) : route.fulfill({ status: 404, body: '' });
  });
  await page.route(/^https:\/\/api\.cesium\.com\/v1\/assets\/424242(\/endpoint)?(\?.*)?$/, (route) => {
    const request = route.request();
    record(request.url(), request.headers()['authorization']);
    const endpoint = new URL(request.url()).pathname.endsWith('/endpoint');
    return route.fulfill({
      json: endpoint
        ? { type: '3DTILES', externalType: '3DTILES', options: { url: ELSEWHERE_URL }, attributions: [] }
        : { id: ION_ASSET, type: '3DTILES', status: 'COMPLETE', name: 'Served from elsewhere' },
    });
  });
  await page.route(/^https:\/\/assets\.ion\.cesium\.com\//, (route) => {
    const request = route.request();
    record(request.url(), request.headers()['authorization']);
    return route.fulfill({ status: 401, json: { code: 'InvalidCredentials', message: 'Invalid access token' } });
  });
  return requests;
}
