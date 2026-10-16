import { setLoaderOptions } from '@loaders.gl/core';

import { bundledDraco3d, fetchWasm, type Draco3dModule } from './dracoDecoder';
import { assetBaseUrl } from './keplerConfig';

/**
 * loaders.gl, told never to fetch code from anywhere but the plugin itself.
 *
 * Every map format kepler and deck.gl read goes through loaders.gl, and its
 * defaults reach out to third-party hosts for code at runtime:
 *
 * - **Workers.** A loader that can run in a Web Worker does, by default, and
 *   the worker script comes from `https://unpkg.com/@loaders.gl/<module>@<version>/dist/`
 *   unless a `workerUrl` says otherwise — Draco meshes in 3D Tiles and glTF,
 *   I3S content, vector tiles, terrain, compressed textures, and the GeoJSON,
 *   shapefile, FlatGeobuf and WKB files dropped on the map. kepler even names
 *   the unpkg URLs itself for three of them.
 * - **Decoders.** Draco's comes from `www.gstatic.com`, its encoder from
 *   GitHub, and the Basis/KTX2 texture transcoders and the crunch decoder from
 *   `<CDN>/textures@<version>/dist/libs/`, where `CDN` defaults to unpkg.
 * - **Parquet.** Its WebAssembly reader defaults to `https://unpkg.com/parquet-wasm@…`.
 *
 * One call at module load closes all of them, for every copy of loaders.gl in
 * the bundle: there are several (kepler's packages nest 4.4.1 and 4.5.4 beside
 * the 4.4.5 deck.gl uses), and they keep their global options on the same
 * `globalThis.loaders` object, so options set through any one copy are read by
 * all. A loader merges them under whatever its caller passes, so they hold
 * unless a caller asks for workers or a CDN explicitly — none in the bundle does.
 *
 * - `worker: false` parses on the main thread with the loader's own code, all
 *   of which is already in the bundle. kepler's unpkg `workerUrl`s are then
 *   never read.
 * - `modules.draco3d` is the Draco decoder compiled into the plugin
 *   (`dracoDecoder.ts`), which loaders.gl calls instead of loading Google's.
 * - The Basis transcoder and encoder (the latter is what reads KTX2) are
 *   shipped under `loaders/` and named by file in `modules`;
 *   `useLocalLibraries` makes loaders.gl look there even for libraries whose
 *   default is a full URL.
 * - `CDN` is the plugin's own `loaders/` folder, so a library this list does
 *   not name (the crunch decoder, Draco's pure-JavaScript fallback) misses on
 *   the plugin's own host instead of being fetched from unpkg.
 * - `parquet.wasmUrl` is the copy of parquet-wasm's WebAssembly the plugin
 *   ships, for a Parquet file dropped on the map.
 *
 * In the deferred chunk with the rest of kepler (see `KeplerMap.tsx`), not in
 * module.ts: nothing loads before the map does.
 */

/** Where, under the plugin's asset path, the loader libraries are served. webpack.config.ts copies them there. */
export const LOADER_LIBRARY_DIR = 'loaders';

/**
 * The files loaders.gl loads by name, all shipped in `LOADER_LIBRARY_DIR`.
 *
 * The keys are the names loaders.gl asks for; each is the file of the same name
 * in `@loaders.gl/textures/dist/libs/`.
 */
export const SHIPPED_LOADER_LIBRARIES = [
  'basis_transcoder.js',
  'basis_transcoder.wasm',
  'basis_encoder.js',
  'basis_encoder.wasm',
] as const;

/** The Draco decoder's WebAssembly, from the `draco3d` package. */
export const DRACO_DECODER_WASM = 'draco_decoder.wasm';

/** parquet-wasm's WebAssembly, emitted under this name by webpack.config.ts. */
export const PARQUET_WASM = 'parquet_wasm_bg.wasm';

/**
 * The plugin's loader folder as an absolute URL.
 *
 * Absolute because loaders.gl refuses a `CDN` that does not start with `http`,
 * and resolved against the document because the public path can be relative
 * to Grafana's root.
 */
export function loaderLibraryBaseUrl(): string {
  return new URL(`${assetBaseUrl()}/${LOADER_LIBRARY_DIR}/`, document.baseURI).href.replace(/\/$/, '');
}

/** The global loaders.gl options described above, for libraries served from `base`. */
export function pluginLoaderOptions(base: string, draco3d: Draco3dModule) {
  return {
    core: {
      worker: false,
      useLocalLibraries: true,
      CDN: base,
    },
    modules: {
      draco3d,
      ...Object.fromEntries(SHIPPED_LOADER_LIBRARIES.map((name) => [name, `${base}/${name}`])),
    },
    parquet: {
      wasmUrl: `${base}/${PARQUET_WASM}`,
    },
  };
}

/** Must run before any loader does; `KeplerMap.tsx` calls it at module load. */
export function configureLoaders(): void {
  const base = loaderLibraryBaseUrl();
  const draco3d = bundledDraco3d(() => fetchWasm(`${base}/${DRACO_DECODER_WASM}`));
  setLoaderOptions(pluginLoaderOptions(base, draco3d));
}
