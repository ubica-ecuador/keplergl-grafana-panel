import { loaderLibraryBaseUrl } from './loaderOptions';

/**
 * sql.js for kepler's GeoPackage export, loaded from the plugin instead of a CDN.
 *
 * kepler.gl 3.3.0-alpha.17 writes a GeoPackage — an SQLite file — with sql.js,
 * SQLite compiled to WebAssembly. Its `@kepler.gl/processors` loads it by adding
 * a `<script>` for `https://cdn.jsdelivr.net/npm/sql.js@<version>/dist/sql-wasm.js`
 * to the page and pointing the WebAssembly at the same host: kepler's demo
 * cannot bundle the package, whose browser build names Node's `fs`, `path` and
 * `crypto`. A plugin may not run code from a third-party host, and Grafana's
 * Content-Security-Policy would refuse the script anyway.
 *
 * webpack.config.ts swaps kepler's `./sql-js` for this module, which exports the
 * one function kepler calls. The JavaScript half is the `sql.js` package kepler
 * depends on, imported, so it is part of the bundle; its Node-only requires are
 * stubbed out there, as for the Draco decoder. The WebAssembly half is a file the
 * plugin ships in `loaders/`. Both arrive the first time a map is exported as a
 * GeoPackage: a dynamic import, so no other map pays for them.
 */

/** sql.js's WebAssembly, copied to the loader folder by webpack.config.ts. */
export const SQL_JS_WASM = 'sql-wasm.wasm';

/** What sql.js resolves to: its `Database` class and the rest, opaque to this module. */
type SqlJsStatic = Record<string, unknown>;

type InitSqlJs = (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;

/** Where sql.js finds a file it asks for by name: the plugin's loader folder, whatever the file. */
export function locateSqlJsFile(base: string): (file: string) => string {
  return (file) => `${base}/${file}`;
}

let loading: Promise<SqlJsStatic> | null = null;

/** kepler's `loadSqlJs`: sql.js, started once and shared. A failed start is forgotten, so the next export tries again. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  loading ??= import('sql.js/dist/sql-wasm.js')
    .then((module) => (module.default as InitSqlJs)({ locateFile: locateSqlJsFile(loaderLibraryBaseUrl()) }))
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}
