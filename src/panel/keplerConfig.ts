import { initApplicationConfig } from '@kepler.gl/utils';

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
function assetBaseUrl(): string {
  const publicPath = typeof __webpack_public_path__ === 'string' ? __webpack_public_path__ : '';
  return publicPath.replace(/\/$/, '');
}

/**
 * kepler.gl's official escape hatch for embedding it in another application.
 * Called once at module load, before any kepler component mounts.
 */
export function configureKepler(): void {
  initApplicationConfig({
    cdnUrl: assetBaseUrl(),
    // A "new release" banner has no place inside a dashboard panel.
    showReleaseBanner: false,
    // The Flow layer is the reason this plugin pins kepler.gl 3.3.0-alpha.3
    // rather than the 3.2.6 stable. Stated explicitly so a change in the
    // upstream default cannot silently remove it.
    enableFlowLayer: true,
  });
}
