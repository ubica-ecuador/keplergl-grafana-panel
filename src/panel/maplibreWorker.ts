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

/**
 * The URL MapLibre should start its workers from: the worker itself when the
 * plugin is served from Grafana's own origin, else a same-origin blob module
 * that imports it.
 *
 * Grafana Cloud serves plugins from its CDN, another origin, and a worker must
 * come from the page's own. MapLibre would wrap a cross-origin URL in such a
 * blob itself, but webpack compiles the `new URL(url, import.meta.url)` it
 * builds the import with into an empty module context that throws "Cannot find
 * module", so no worker started and no base map drew there. A blob URL is
 * same-origin, so MapLibre starts it as it is. It is never revoked: MapLibre
 * starts a worker from it each time its pool fills.
 */
export function maplibreWorkerSource(workerUrl: string, pageOrigin: string): string {
  if (new URL(workerUrl).origin === pageOrigin) {
    return workerUrl;
  }
  const module = new Blob([`import ${JSON.stringify(workerUrl)};`], { type: 'text/javascript' });
  return URL.createObjectURL(module);
}

export function configureMaplibreWorker(): void {
  setWorkerUrl(maplibreWorkerSource(maplibreWorkerUrl(), window.location.origin));
}
