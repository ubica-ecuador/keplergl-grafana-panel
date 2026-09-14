import { messages } from '@kepler.gl/localization';
import { initApplicationConfig } from '@kepler.gl/utils';

import { DEFAULT_RASTER_SERVER_URL } from './constants';
import { registerFlowFieldMessages } from './flowFieldMessages';
import { registerTile3dMessages } from './tile3dMessages';

/**
 * Base URL for kepler's own static assets.
 *
 * By default kepler fetches its icon library at runtime from a hosted CDN. That
 * does not work here on two counts: Grafana's strict Content-Security-Policy
 * blocks the request via `connect-src` and it surfaces as an unhandled "Failed
 * to fetch", and air-gapped installs have no route to it at all.
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
 * kepler.gl's official escape hatch for embedding it in another application.
 * Called once at module load, before any kepler component mounts.
 */
export function configureKepler(): void {
  initApplicationConfig({
    cdnUrl: assetBaseUrl(),
    rasterServerUrls: [DEFAULT_RASTER_SERVER_URL],
    // A "new release" banner has no place inside a dashboard panel.
    showReleaseBanner: false,
    // The Flow layer is the reason this plugin pins kepler.gl 3.3.0-alpha.11
    // rather than the 3.2.6 stable. Stated explicitly so a change in the
    // upstream default cannot silently remove it.
    enableFlowLayer: true,
    // deck.gl's map controller stops at 60 degrees, which is short of the
    // near-ground view a 3D tileset is worth looking at: the scene this was
    // measured against sits at 69.5. kepler documents this as the way to raise
    // it and only clamps back to 60 for the Mapbox adapter, which this plugin
    // does not use. Nothing saved changes — a stored viewport keeps its own
    // pitch; this only widens how far the user may tilt. Measured: without it
    // a pitch set programmatically snaps back to 60 on the first drag.
    maxPitch: 85,
  });

  // The flow field is a layer kepler does not ship, so its words are in no
  // catalogue: without this its labels render as their own message ids.
  registerFlowFieldMessages(messages);

  // The 3D tile layer is kepler's, but the two altitude knobs are not, so its
  // panel would show them as their own message ids.
  registerTile3dMessages(messages);
}
