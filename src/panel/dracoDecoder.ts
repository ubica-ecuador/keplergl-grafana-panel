import DracoDecoderModule from 'draco3d/draco_decoder_nodejs.js';

/**
 * The Draco decoder, compiled into the plugin instead of fetched at runtime.
 *
 * loaders.gl decodes Draco-compressed meshes — Google's Photorealistic 3D
 * Tiles, most glTF and b3dm exported with compression — with Google's decoder,
 * which it does not bundle: left to itself it downloads the JavaScript half
 * from `www.gstatic.com` and evaluates it, and fetches the WebAssembly half
 * from the same place. A plugin may not run code from a third-party host, and
 * under Grafana's Content-Security-Policy that script would be refused anyway.
 *
 * loaders.gl's documented way out is to hand it the `draco3d` npm package as
 * `options.modules.draco3d`, which it then calls instead of loading anything.
 * That package is the one `@loaders.gl/draco` itself depends on, so the copy
 * here is the decoder loaders.gl was built against. Its JavaScript half is
 * imported, so it is part of the bundle; its WebAssembly half is a file the
 * plugin ships (webpack.config.ts copies it to `loaders/`) and `loadWasm`
 * fetches from the plugin's own asset path.
 *
 * The package's file is named for Node.js but is Emscripten's usual
 * environment-sniffing build: in the browser it takes the web path, and the
 * Node-only `fs`/`path` requires inside it are stubbed out by webpack.config.ts.
 */

/** What Emscripten hands `onModuleLoaded`: the decoder's classes and constants, opaque to this module. */
type DracoModule = Record<string, unknown>;

/**
 * Something with a `then`, as loaders.gl expects from `createDecoderModule`.
 *
 * Not a Promise on purpose: Emscripten's module object has been promise-like
 * in some releases, and a Promise resolved with a promise-like value adopts it
 * instead of holding it — loaders.gl's own loader wraps the module in an
 * object for that reason. This hands the module straight to the callback.
 */
interface DecoderThenable {
  then<T>(onFulfilled: (draco: DracoModule) => T, onRejected?: (reason: unknown) => T): Promise<T>;
}

/** The shape loaders.gl reads from `options.modules.draco3d`. */
export interface Draco3dModule {
  createDecoderModule: (options?: Record<string, unknown>) => DecoderThenable;
  createEncoderModule: (options?: Record<string, unknown>) => Promise<never>;
}

/**
 * `options.modules.draco3d` for loaders.gl, decoding with the bundled decoder.
 *
 * `loadWasm` supplies the WebAssembly half. It is called once, the first time a
 * Draco mesh arrives, so a map that never draws one never downloads it.
 */
export function bundledDraco3d(loadWasm: () => Promise<ArrayBuffer>): Draco3dModule {
  let loading: Promise<{ draco: DracoModule }> | undefined;

  const load = () =>
    (loading ??= loadWasm().then(
      (wasmBinary) =>
        new Promise<{ draco: DracoModule }>((resolve, reject) => {
          const ready = DracoDecoderModule({
            wasmBinary,
            onModuleLoaded: (draco: DracoModule) => resolve({ draco }),
            onAbort: (what: unknown) => reject(new Error(`The Draco decoder failed to start: ${String(what)}`)),
          });
          // The same failure also rejects Emscripten's own promise; it is
          // reported through `onAbort` above, not as an unhandled rejection.
          ready?.catch?.(() => undefined);
        })
    ));

  return {
    createDecoderModule: () => ({
      then: (onFulfilled, onRejected) => load().then(({ draco }) => onFulfilled(draco), onRejected),
    }),
    // Encoding is loaders.gl's DracoWriter, which nothing in the plugin uses.
    // Supplying `draco3d` makes loaders.gl ask this object for the encoder too,
    // instead of downloading one from GitHub; it gets a refusal, not a fetch.
    createEncoderModule: () => Promise.reject(new Error('The Draco encoder is not shipped with this plugin')),
  };
}

/** Fetches the decoder's WebAssembly from `url`, failing loudly on a missing file rather than handing Emscripten an error page. */
export async function fetchWasm(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}
