/**
 * The base URL webpack resolves the plugin's own assets from.
 *
 * The scaffold sets this at runtime from the AMD module URI, so it accounts for
 * Grafana running under a sub-path or serving plugin assets from a CDN.
 */
declare const __webpack_public_path__: string;

/**
 * A stylesheet imported as its text, for emotion to scope (see
 * `panel/maplibreStyles.ts`). The root webpack config serves `?raw` as a
 * string instead of handing it to the scaffold's style-loader, which would
 * inject it into the page as it is.
 */
declare module '*.css?raw' {
  const text: string;
  export default text;
}
