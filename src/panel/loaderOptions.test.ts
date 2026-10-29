import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { MVTLayer } from '@deck.gl/geo-layers';
import { getLoaderOptions, parse } from '@loaders.gl/core';
import type { Loader } from '@loaders.gl/loader-utils';
import { MVTWorkerLoader } from '@loaders.gl/mvt';
import { getLibraryUrl } from '@loaders.gl/worker-utils';

import {
  configureLoaders,
  DRACO_DECODER_WASM,
  loaderLibraryBaseUrl,
  PARQUET_WASM,
  pluginLoaderOptions,
  SHIPPED_LOADER_LIBRARIES,
} from './loaderOptions';
import { bundledDraco3d } from './dracoDecoder';

/**
 * The loaders.gl options that keep every worker script and decoder on the
 * plugin's own host. What they buy is described in loaderOptions.ts; these
 * tests hold the wiring, and dracoDecoder.test.ts decodes real data with it.
 */

const BASE = 'https://grafana.example/public/plugins/ubica-keplergl-panel/loaders';
const THIRD_PARTY = /unpkg\.com|jsdelivr\.net|gstatic\.com|githubusercontent\.com/;
const ROOT = join(__dirname, '..', '..');

const draco3d = bundledDraco3d(() => Promise.reject(new Error('not needed here')));

/** Every URL in an options object, however deep. */
const urlsIn = (value: unknown): string[] =>
  typeof value === 'string'
    ? /^https?:/.test(value)
      ? [value]
      : []
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(urlsIn)
      : [];

/**
 * Each nested copy of `@loaders.gl/core` that kepler's and hubble.gl's packages
 * bring in, wherever npm put them. They are bundled too, and each reads the
 * global options for the loads it makes.
 */
function nestedLoaderCores(): string[] {
  const found: string[] = [];
  for (const scope of ['@kepler.gl', '@hubble.gl']) {
    const scopeDir = join(ROOT, 'node_modules', scope);
    if (!existsSync(scopeDir)) {
      continue;
    }
    for (const pkg of readdirSync(scopeDir)) {
      const core = join(scopeDir, pkg, 'node_modules', '@loaders.gl', 'core');
      if (existsSync(join(core, 'package.json'))) {
        found.push(core);
      }
    }
  }
  return found;
}

describe('pluginLoaderOptions', () => {
  const options = pluginLoaderOptions(BASE, draco3d);

  it('turns workers off, so no worker script is ever fetched', () => {
    expect(options.core.worker).toBe(false);
  });

  it('points the CDN at the plugin, and resolves libraries locally even where the default is a full URL', () => {
    expect(options.core.CDN).toBe(BASE);
    expect(options.core.useLocalLibraries).toBe(true);
  });

  it('decodes Draco with the bundled decoder', () => {
    expect(options.modules.draco3d).toBe(draco3d);
  });

  it('names a shipped file for every library it maps', () => {
    for (const name of SHIPPED_LOADER_LIBRARIES) {
      expect((options.modules as Record<string, unknown>)[name]).toBe(`${BASE}/${name}`);
    }
  });

  it('reads Parquet with the WebAssembly the plugin ships', () => {
    expect(options.parquet.wasmUrl).toBe(`${BASE}/${PARQUET_WASM}`);
  });

  it('names no third-party host anywhere', () => {
    const urls = urlsIn(options);

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toMatch(THIRD_PARTY);
      expect(url.startsWith(`${BASE}/`) || url === BASE).toBe(true);
    }
  });
});

describe('the shipped files', () => {
  // The same sources webpack.config.ts copies into dist/loaders/, read where
  // it reads them: a library renamed or dropped upstream should fail here,
  // not as a texture that never decodes on someone's dashboard.
  it.each(SHIPPED_LOADER_LIBRARIES)('%s exists in @loaders.gl/textures', (name) => {
    expect(existsSync(join(ROOT, 'node_modules', '@loaders.gl', 'textures', 'dist', 'libs', name))).toBe(true);
  });

  it('the Draco decoder’s WebAssembly exists in draco3d', () => {
    expect(existsSync(join(ROOT, 'node_modules', 'draco3d', DRACO_DECODER_WASM))).toBe(true);
  });

  it('the Parquet WebAssembly exists in parquet-wasm', () => {
    expect(existsSync(join(ROOT, 'node_modules', 'parquet-wasm', 'esm', PARQUET_WASM))).toBe(true);
  });
});

describe('configureLoaders', () => {
  beforeAll(() => configureLoaders());

  it('serves the libraries from the plugin’s own asset path, as an absolute URL', () => {
    // jest has no webpack public path, so the asset base is the document root.
    expect(loaderLibraryBaseUrl()).toBe(new URL('/loaders', document.baseURI).href);
  });

  it('sets the options globally, where every loader reads them', () => {
    const global = getLoaderOptions() as { core?: Record<string, unknown>; modules?: Record<string, unknown> };

    expect(global.core?.worker).toBe(false);
    expect(global.core?.useLocalLibraries).toBe(true);
    expect(global.core?.CDN).toBe(loaderLibraryBaseUrl());
    expect(global.modules?.draco3d).toBeDefined();
  });

  it('reaches the copies of loaders.gl nested under kepler.gl and hubble.gl', () => {
    const copies = nestedLoaderCores();

    // There are several today; the point is that each sees the same options.
    for (const copy of copies) {
      const { getLoaderOptions: nestedOptions } = require(copy) as typeof import('@loaders.gl/core');
      const options = nestedOptions() as { core?: Record<string, unknown> };

      expect(options.core?.worker).toBe(false);
      expect(options.core?.CDN).toBe(loaderLibraryBaseUrl());
    }
  });

  it('resolves a Basis transcoder to the plugin’s copy rather than unpkg’s', () => {
    const global = getLoaderOptions() as { core?: { useLocalLibraries?: boolean; CDN?: string }; modules?: object };
    const loadOptions = { useLocalLibraries: global.core?.useLocalLibraries, CDN: global.core?.CDN, modules: global.modules };

    expect(getLibraryUrl('basis_transcoder.js', 'textures', loadOptions)).toBe(
      `${loaderLibraryBaseUrl()}/basis_transcoder.js`
    );
    // Draco's default is a full URL on www.gstatic.com, which loaders.gl
    // would use as it is without `useLocalLibraries`.
    expect(
      getLibraryUrl(
        'https://www.gstatic.com/draco/versioned/decoders/1.5.6/draco_wasm_wrapper.js',
        'draco',
        loadOptions,
        'draco_wasm_wrapper.js'
      )
    ).not.toMatch(THIRD_PARTY);
  });
});

describe('mainThreadLoaders', () => {
  beforeAll(() => {
    // jsdom has no fetch API, and loaders.gl asks whether what it is handed is
    // a `Response` before parsing it (as in dracoDecoder.test.ts).
    (globalThis as { Response?: unknown }).Response ??= class Response {};
    configureLoaders();
  });

  // An empty vector tile: a tile with no layers is a valid one.
  const EMPTY_TILE = new ArrayBuffer(0);
  const TILE_OPTIONS = {
    mvt: { shape: 'geojson' as const, coordinates: 'wgs84' as const, tileIndex: { x: 0, y: 0, z: 0 } },
  };

  it('without it, deck’s default vector tile loader cannot parse with workers off', async () => {
    await expect(parse(EMPTY_TILE, MVTWorkerLoader, TILE_OPTIONS)).rejects.toThrow(/no parser found/);
  });

  it('gives deck’s MVTLayer, which kepler’s globe draws its base map with, a loader that parses on the main thread', async () => {
    const [loader] = MVTLayer.defaultProps.loaders as Loader[];

    await expect(parse(EMPTY_TILE, loader, TILE_OPTIONS)).resolves.toEqual([]);
  });
});
