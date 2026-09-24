import { setWorkerUrl } from 'maplibre-gl';

import { assetBaseUrl } from './keplerConfig';

/**
 * Where MapLibre's worker is served from, and the call that tells MapLibre so.
 *
 * MapLibre 6 ships as ES modules only and finds its worker next to its own
 * module, from `import.meta.url`. Inside this plugin's bundle that URL is the
 * `file://` path webpack saw at build time, which MapLibre rejects, so it would
 * start no worker and draw no base map. webpack.config.ts copies the worker and
 * the `maplibre-gl-shared.mjs` it imports into `dist/maplibre/`, and this points
 * MapLibre at that copy.
 *
 * Resolved against the document rather than left relative: the public path can
 * be relative to Grafana's root, and a module worker resolves its own imports
 * against the URL it was created from.
 *
 * Kept out of keplerConfig.ts because unit tests import that module, and jest
 * cannot load MapLibre's ES-module-only build.
 */
export function maplibreWorkerUrl(): string {
  return new URL(`${assetBaseUrl()}/maplibre/maplibre-gl-worker.mjs`, document.baseURI).href;
}

export function configureMaplibreWorker(): void {
  setWorkerUrl(maplibreWorkerUrl());
}
