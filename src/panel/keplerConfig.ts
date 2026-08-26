import { initApplicationConfig } from '@kepler.gl/utils';

import { DEFAULT_RASTER_SERVER_URL } from './constants';

/**
 * Base URL for kepler's own static assets.
 *
 * By default kepler fetches its icon library at runtime from
 * `studio-public-data.foursquare.com`. That is wrong here on three counts: a
 * plugin whose whole premise is escaping the Foursquare hosted dependency
 * should not call a Foursquare CDN; Grafana's strict Content-Security-Policy
 * blocks the request via `connect-src` and it surfaces as an unhandled "Failed
 * to fetch"; and air-gapped installs have no route to it at all.
 *
 * `src/icons/svg-icons.json` is vendored from kepler.gl (MIT) and copied into
 * dist by the scaffold's `**\/*.json` rule, so it is served from the plugin's
 * own asset path.
 *
 * Read from webpack's public path rather than hardcoded: Grafana can serve
 * plugin assets from a sub-path or from a CDN, and the scaffold already
 * resolves that at runtime from the AMD module URI.
 */
export function assetBaseUrl(): string {
  const publicPath = typeof __webpack_public_path__ === 'string' ? __webpack_public_path__ : '';
  return publicPath.replace(/\/$/, '');
}

/**
 * Raster tile server offered by default when adding a COG or STAC tileset.
 *
 * kepler ships a RasterTileLayer but no server to feed it: the stock
 * `rasterServerUrls` is an empty list — with a literal `// TODO` upstream — and
 * the layer throws 'No raster tile servers' before it ever reaches the network.
 *
 * This is the public demo TiTiler. It is only a default: the value seeds the
 * "raster tile server" field of the Add Data → Tileset form, and the server a
 * dataset actually uses travels in that dataset's own metadata. Two
 * consequences worth knowing before debugging a tile that never arrives:
 *
 *  - Pasting a bare `.tif` into that form ignores this entirely. kepler decides
 *    a URL is a COG from its pathname and then hardcodes `titiler.xyz` for both
 *    the metadata and the tiles, with no way to override it from the form. To
 *    use our own server, paste the STAC URL — `<server>/cog/stac?url=<cog>` —
 *    whose pathname is `/cog/stac`, so it does not trip that branch.
 *  - Grafana's strict CSP must allow this host under `connect-src`: the tiles
 *    are NumPy arrays fetched with XHR, not images.
 *
 * Rasters the panel builds from a query do not read this: they carry their own
 * server, from the panel option, so two panels on one dashboard can draw from
 * different servers.
 */

/**
 * kepler.gl's official escape hatch for embedding it in another application.
 * Called once at module load, before any kepler component mounts.
 */
export function configureKepler(): void {
  initApplicationConfig({
    cdnUrl: assetBaseUrl(),
    rasterServerUrls: [DEFAULT_RASTER_SERVER_URL],
    // A "new release" banner has no place inside a dashboard panel.
    showReleaseBanner: false,
    // The Flow layer is the reason this plugin pins kepler.gl 3.3.0-alpha.3
    // rather than the 3.2.6 stable. Stated explicitly so a change in the
    // upstream default cannot silently remove it.
    enableFlowLayer: true,
  });
}
