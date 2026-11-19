import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { loadSqlJs, locateSqlJsFile, SQL_JS_WASM } from './exportSqlJs';

/**
 * kepler's Export data as GeoPackage and GeoParquet, kept off cdn.jsdelivr.net
 * and unpkg.com. webpack.config.ts swaps the sql.js loader under test in for
 * kepler's own; these tests hold what it does, that kepler still asks for it by
 * the request the swap matches, and that its GeoParquet writer reads the
 * WebAssembly URL loaderOptions.ts gives it.
 */

const BASE = 'https://grafana.example/public/plugins/ubica-keplergl-panel/loaders';
const ROOT = join(__dirname, '..', '..');
const KEPLER_EXPORT = join(ROOT, 'node_modules', '@kepler.gl', 'processors', 'dist', 'esm', 'export');

jest.mock('./loaderOptions', () => ({
  ...jest.requireActual('./loaderOptions'),
  loaderLibraryBaseUrl: () => BASE,
}));

const initSqlJs = jest.fn();
jest.mock('sql.js/dist/sql-wasm.js', () => ({
  __esModule: true,
  default: (settings: unknown) => initSqlJs(settings),
}));

describe('loadSqlJs', () => {
  // One test, in order: the module keeps what it started for the page.
  it('starts sql.js with its WebAssembly from the plugin, again after a failure, then once', async () => {
    const sql = { Database: class Database {} };
    initSqlJs.mockRejectedValueOnce(new Error('no wasm')).mockResolvedValue(sql);

    await expect(loadSqlJs()).rejects.toThrow('no wasm');
    await expect(loadSqlJs()).resolves.toBe(sql);
    await expect(loadSqlJs()).resolves.toBe(sql);

    expect(initSqlJs).toHaveBeenCalledTimes(2);
    const { locateFile } = initSqlJs.mock.calls[1][0];
    expect(locateFile(SQL_JS_WASM)).toBe(`${BASE}/sql-wasm.wasm`);
  });

  it('finds every file it is asked for in the loader folder', () => {
    expect(locateSqlJsFile(BASE)('anything.wasm')).toBe(`${BASE}/anything.wasm`);
  });

  it('names the file webpack.config.ts copies from the package', () => {
    expect(existsSync(join(ROOT, 'node_modules', 'sql.js', 'dist', SQL_JS_WASM))).toBe(true);
  });
});

describe("kepler's export writers", () => {
  it('still load sql.js through `./sql-js`, the request webpack.config.ts swaps', () => {
    const writer = readFileSync(join(KEPLER_EXPORT, 'geopackage-writer.js'), 'utf8');
    expect(writer).toMatch(/import \{ loadSqlJs \} from '\.\/sql-js';/);
  });

  it('start parquet-wasm for GeoParquet from the application config, which loaderOptions.ts sets', () => {
    const writer = readFileSync(join(KEPLER_EXPORT, 'geoparquet-writer.js'), 'utf8');
    expect(writer).toContain('getApplicationConfig().parquetWasmUrl');
  });
});
