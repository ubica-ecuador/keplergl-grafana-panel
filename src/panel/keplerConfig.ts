import { initApplicationConfig } from '@kepler.gl/utils';

/**
 * kepler.gl's official escape hatch for embedding it in another application.
 * Called once at module load, before any kepler component mounts.
 *
 * Known gap, deferred to Phase 1: kepler fetches its icon library at runtime
 * from `cdnUrl` (defaults to studio-public-data.foursquare.com). Under Grafana's
 * strict Content-Security-Policy that fetch is blocked by `connect-src` and
 * surfaces as an unhandled "Failed to fetch". The fix is to ship the icon JSON
 * with the plugin and point `cdnUrl` at our own same-origin asset path, which
 * also makes the plugin work air-gapped.
 */
export function configureKepler(): void {
  initApplicationConfig({
    // A "new release" banner has no place inside a dashboard panel.
    showReleaseBanner: false,
    // The Flow layer is the reason this plugin pins kepler.gl 3.3.0-alpha.3
    // rather than the 3.2.6 stable. Stated explicitly so a change in the
    // upstream default cannot silently remove it.
    enableFlowLayer: true,
  });
}
