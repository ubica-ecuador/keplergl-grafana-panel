import { readFileSync } from 'fs';
import { parse, setLoaderOptions } from '@loaders.gl/core';
import { DracoLoader } from '@loaders.gl/draco';
import { GLTFLoader } from '@loaders.gl/gltf';

import { bundledDraco3d } from './dracoDecoder';
import { pluginLoaderOptions } from './loaderOptions';

/**
 * The decoder the plugin ships, decoding real Draco data through loaders.gl
 * exactly as a 3D tile's or a glTF's mesh is decoded: with the options
 * `configureLoaders` sets globally and nothing passed per call.
 *
 * The bunny is the sample the `draco3d` package itself ships: 34,834 vertices
 * and 69,451 triangles, compressed. `fetch` throws throughout, so a decoder
 * that went looking for code on the network fails the test instead of passing
 * it on a machine that happens to be online.
 */

const BUNNY = readFileSync(require.resolve('draco3d/bunny.drc'));
const BUNNY_VERTICES = 34834;
const BUNNY_TRIANGLES = 69451;

const wasmFromDisk = jest.fn(async () => {
  const bytes = readFileSync(require.resolve('draco3d/draco_decoder.wasm'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
});

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** Pads to the four-byte boundary GLB chunks require. */
const padded = (bytes: Uint8Array, fill: number): Uint8Array => {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill);
  out.set(bytes);
  return out;
};

/**
 * A one-mesh GLB whose only primitive is the bunny, Draco-compressed under
 * KHR_draco_mesh_compression — the shape of a b3dm's or a Google 3D tile's glTF.
 */
function dracoGlb(draco: Uint8Array): ArrayBuffer {
  const bin = padded(draco, 0);
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: draco.length }],
    accessors: [
      { componentType: 5126, count: BUNNY_VERTICES, type: 'VEC3' },
      { componentType: 5125, count: BUNNY_TRIANGLES * 3, type: 'SCALAR' },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            mode: 4,
            extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } },
          },
        ],
      },
    ],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const jsonChunk = padded(new TextEncoder().encode(JSON.stringify(json)), 0x20);

  const glb = new Uint8Array(12 + 8 + jsonChunk.length + 8 + bin.length);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.length, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  glb.set(jsonChunk, 20);
  const binAt = 20 + jsonChunk.length;
  view.setUint32(binAt, bin.length, true);
  view.setUint32(binAt + 4, 0x004e4942, true); // 'BIN\0'
  glb.set(bin, binAt + 8);
  return glb.buffer;
}

describe('the bundled Draco decoder', () => {
  const fetchSpy = jest.fn(() => Promise.reject(new Error('the network is not to be used')));

  beforeAll(() => {
    const scope = globalThis as { fetch?: unknown; Response?: unknown };
    scope.fetch = fetchSpy;
    // jsdom has no fetch API, and loaders.gl asks whether what it is handed is
    // a `Response` before parsing it; an ArrayBuffer is not one either way.
    scope.Response ??= class Response {};
    setLoaderOptions(pluginLoaderOptions('https://grafana.test/public/plugins/p/loaders', bundledDraco3d(wasmFromDisk)));
  });

  it('decodes a Draco mesh through loaders.gl with only the global options', async () => {
    const mesh = await parse(arrayBufferOf(BUNNY), DracoLoader);

    expect(mesh.header?.vertexCount).toBe(BUNNY_VERTICES);
    expect(mesh.attributes.POSITION.value).toHaveLength(BUNNY_VERTICES * 3);
    expect(mesh.indices?.value).toHaveLength(BUNNY_TRIANGLES * 3);
  });

  it('decodes a Draco-compressed glTF primitive, as a 3D tile carries one', async () => {
    const gltf = await parse(dracoGlb(BUNNY), GLTFLoader, { gltf: { decompressMeshes: true } });
    const primitive = gltf.json.meshes?.[0].primitives[0] as unknown as {
      attributes: Record<string, { value: ArrayLike<number> }>;
      extensions?: Record<string, unknown>;
    };

    expect(primitive.attributes.POSITION.value).toHaveLength(BUNNY_VERTICES * 3);
    // Decompressed in place: the extension is gone once the mesh is decoded.
    expect(primitive.extensions?.KHR_draco_mesh_compression).toBeUndefined();
  });

  it('starts the decoder once, however many meshes arrive', () => {
    expect(wasmFromDisk).toHaveBeenCalledTimes(1);
  });

  it('fetched nothing', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to encode rather than fetching an encoder', async () => {
    await expect(bundledDraco3d(wasmFromDisk).createEncoderModule()).rejects.toThrow(/not shipped/);
  });
});
