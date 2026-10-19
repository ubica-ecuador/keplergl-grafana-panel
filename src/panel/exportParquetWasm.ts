import initParquetWasm from 'parquet-wasm';

import { loaderLibraryBaseUrl, PARQUET_WASM } from './loaderOptions';

export * from 'parquet-wasm';

/**
 * parquet-wasm for kepler's GeoParquet export, started from the plugin's copy.
 *
 * kepler.gl 3.3.0-alpha.17 writes GeoParquet with parquet-wasm, imports the
 * package and starts it with `https://unpkg.com/parquet-wasm@<version>/…`, a
 * URL of its own. A plugin may not fetch code from a third-party host, and the
 * plugin already ships that WebAssembly: loaders.gl's Parquet reader is given
 * the same file in `loaderOptions.ts`.
 *
 * webpack.config.ts hands kepler's GeoParquet writer this module in place of
 * `parquet-wasm`: the package itself, re-exported, with a start that ignores the
 * URL it is passed and reads the plugin's copy instead. parquet-wasm starts
 * once per page, so whichever of the reader and the writer comes first, the
 * other finds it started from the same file.
 */
export default function startParquetWasm(): ReturnType<typeof initParquetWasm> {
  return initParquetWasm(`${loaderLibraryBaseUrl()}/${PARQUET_WASM}`);
}
