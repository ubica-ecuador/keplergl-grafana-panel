/**
 * The base URL webpack resolves the plugin's own assets from.
 *
 * The scaffold sets this at runtime from the AMD module URI, so it accounts for
 * Grafana running under a sub-path or serving plugin assets from a CDN.
 */
declare const __webpack_public_path__: string;

/**
 * Side-effect imports of stylesheets, which webpack turns into injected CSS.
 *
 * The scaffold's `.config/types/bundler-rules.d.ts` declares the image and font
 * loaders' extensions but not this one. TypeScript 5 let the untyped import
 * pass; from TypeScript 6 a side-effect import with no declaration is an error
 * (TS2882), so the module has to be declared somewhere we own.
 */
declare module '*.css';
