/**
 * The base URL webpack resolves the plugin's own assets from.
 *
 * The scaffold sets this at runtime from the AMD module URI, so it accounts for
 * Grafana running under a sub-path or serving plugin assets from a CDN.
 */
declare const __webpack_public_path__: string;
