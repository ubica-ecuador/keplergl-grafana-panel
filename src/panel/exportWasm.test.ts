import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { loadSqlJs, locateSqlJsFile, SQL_JS_WASM } from './exportSqlJs';
import startParquetWasm, * as parquetWasm from './exportParquetWasm';

/**
 * kepler's Export data as GeoPackage and GeoParquet, kept off cdn.jsdelivr.net
 * and unpkg.com. webpack.config.ts swaps the two modules under test in for
 * kepler's own; these tests hold what each does, and that kepler still asks
 * for them by the requests the swap matches.
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

const initParquetWasm = jest.fn();
jest.mock('parquet-wasm', () => ({
  __esModule: true,
  default: (input: unknown) => initParquetWasm(input),
  Table: class Table {},
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

describe('startParquetWasm', () => {
  it("starts parquet-wasm from the plugin's copy, whatever URL kepler passes", async () => {
    initParquetWasm.mockResolvedValue({});
    const start = startParquetWasm as unknown as (input?: string) => Promise<unknown>;

    await start('https://unpkg.com/parquet-wasm@0.6.1/esm/parquet_wasm_bg.wasm');

    expect(initParquetWasm).toHaveBeenCalledWith(`${BASE}/parquet_wasm_bg.wasm`);
  });

  it('hands kepler the rest of the package', () => {
    expect(parquetWasm.Table).toBeDefined();
  });
});

describe("kepler's export writers", () => {
  it('still load sql.js through `./sql-js`, the request webpack.config.ts swaps', () => {
    const writer = readFileSync(join(KEPLER_EXPORT, 'geopackage-writer.js'), 'utf8');
    expect(writer).toMatch(/import \{ loadSqlJs \} from '\.\/sql-js';/);
  });

  it('still import `parquet-wasm` for GeoParquet, the request webpack.config.ts swaps', () => {
    const writer = readFileSync(join(KEPLER_EXPORT, 'geoparquet-writer.js'), 'utf8');
    expect(writer).toContain("import('parquet-wasm')");
  });
});
