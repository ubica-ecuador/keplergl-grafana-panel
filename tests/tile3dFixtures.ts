import type { Page } from '@playwright/test';

/**
 * 3D Tiles shaped like the real ones that drew nothing on 2026-09-28, served
 * from a stubbed host so the suite still makes no outbound call.
 *
 * - `world-regions/`: Cesium OSM Buildings' shape. A region round the whole
 *   world, whose first tile is a b3dm with a glTF that has no meshes, then a
 *   nested tileset for the western hemisphere, then a few blocks of Cuenca at
 *   2 490 m.
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

/** A valid glTF with nothing to draw: no `meshes` at all, like OSM Buildings' `root.b3dm`. */
function emptyGlb(): Buffer {
  return glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{}] });
}

/** A batched 3D model wrapping a glb, with an empty batch. */
function b3dm(content: Buffer): Buffer {
  // The glb has to start on an 8-byte boundary: the 28-byte header plus this JSON.
  let featureTable = Buffer.from(JSON.stringify({ BATCH_LENGTH: 0 }));
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
