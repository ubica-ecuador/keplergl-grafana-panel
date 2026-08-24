import CopyWebpackPlugin from 'copy-webpack-plugin';
import path from 'path';
import webpack, { type Configuration } from 'webpack';
import { merge } from 'webpack-merge';

import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  return merge(baseConfig, {
    plugins: [
      /*
       * Static assets kepler fetches at runtime from `cdnUrl` — which
       * keplerConfig.ts points at the plugin's own asset path so air-gapped
       * installs never call the Foursquare CDN. The scaffold only copies JSON
       * (that rule carries the vendored svg-icons.json); these two trees are
       * PNG, vendored from kepler.gl (MIT), and need their own copy rule.
       *
       * `images/effects/*.png` are the effect preview thumbnails.
       *
       * `raster/colormaps/*.png` are the 71 colormaps of RasterTileLayer, and
       * they are load-bearing rather than decorative: raster-tile/image.ts
       * fetches `${cdnUrl}/raster/colormaps/<id>.png` inside the same
       * Promise.all as the tile itself — for every tile, even an RGB composite
       * that never samples a colormap, defaulting to `cfastie`. A 404 there
       * rejects the whole promise, so a missing colormap does not degrade the
       * colouring: it takes the imagery down with it. 18 KB for the set.
       */
      new CopyWebpackPlugin({
        patterns: [
          { from: 'images', to: 'images' },
          { from: 'raster', to: 'raster' },
        ],
      }),
      /*
       * Parts of the kepler.gl tree read the Node `process` global as a free
       * variable, and webpack 5 no longer shims it. Most reads are guarded with
       * `typeof process` or a try/catch, but at least one is not: the plugin
       * fails to load in Grafana with "ReferenceError: process is not defined"
       * before any of our code runs.
       */
      new webpack.ProvidePlugin({
        process: 'process/browser.js',
      }),
      /*
       * kepler's Portaled component parents every dropdown / color picker
       * popover to KeplerGl's root div and positions it `position: fixed` at
       * viewport coordinates. Under Grafana's `.react-grid-item` a CSS
       * transform re-bases those coordinates to the panel and the panel chrome
       * clips them, so side-panel dropdowns opened shifted below their trigger
       * and were cut off at the panel edge — often invisible entirely.
       *
       * Portaled is not an injectable factory, so the swap happens here:
       * every request for the module from inside @kepler.gl resolves to
       * src/panel/portaledBodyMount.tsx, which re-parents the portal to
       * document.body. The issuer check keeps the wrapper's own import of the
       * original from being rewritten into a cycle.
       */
      new webpack.NormalModuleReplacementPlugin(/[\\/]portaled(\.js)?$/, (resource) => {
        const issuer: string = resource.contextInfo?.issuer ?? '';
        if (issuer.includes('@kepler.gl')) {
          resource.request = path.resolve(process.cwd(), 'src', 'panel', 'portaledBodyMount.tsx');
        }
      }),
    ],
    resolve: {
      fallback: {
        /*
         * `@kepler.gl/utils` imports Node's `assert` from data-utils.js and
         * dataset-utils.js, and webpack 5 no longer auto-polyfills core modules.
         * These are not dead paths: dataset-utils validates every dataset handed
         * to `addDataToMap`, so without the polyfill the plugin breaks the first
         * time it loads data. Points at the browser `assert` package.
         */
        assert: path.resolve(process.cwd(), 'node_modules', 'assert'),
      },
      /*
       * Force a single instance of each deck.gl / luma.gl core package.
       *
       * These packages ship both an ESM (`module`) and a CommonJS (`main`)
       * build. kepler and @flowmap.gl resolve them through different entry
       * points, so webpack bundles both builds and deck.gl ends up with TWO
       * shader-hook registries: hooks registered against one instance are
       * invisible to the other. The flow layer's shaders then fail to compile
       * with `DECKGL_FILTER_COLOR: no matching overloaded function found`, and
       * the flow layer renders nothing. Pinning each package to its ESM entry
       * collapses it to one instance and one registry. See visgl/deck.gl FAQ,
       * "duplicate deck.gl bundles".
       */
      alias: {
        ...Object.fromEntries(
          [
            '@deck.gl/core',
            '@luma.gl/core',
            '@luma.gl/engine',
            '@luma.gl/shadertools',
            '@luma.gl/webgl',
            '@luma.gl/constants',
          ].map((pkg) => [`${pkg}$`, path.resolve(process.cwd(), 'node_modules', pkg, 'dist/index.js')])
        ),
        /*
         * Force the ESM build of the map-draw editor. kepler's packages require
         * it from CommonJS, so webpack picks its CJS build — where esbuild's
         * node-mode interop (`__toESM(require(...), 1)`) resolves every
         * `@turf/*` default import to the module's exports *object*, never the
         * function. Every draw mode then throws `(0, x.default) is not a
         * function`: the rectangle on its first click (`bboxPolygon`), the
         * polygon when double-click finishes it (`kinks`) — so drawing a
         * polygon filter was impossible. The ESM build's turf imports resolve
         * through the `import` condition to real functions. All kepler access
         * is via named exports, which survive the CJS-requires-ESM interop.
         */
        '@deck.gl-community/editable-layers$': path.resolve(
          process.cwd(),
          'node_modules',
          '@deck.gl-community',
          'editable-layers',
          'dist/index.js'
        ),
      },
    },
    module: {
      rules: [
        /*
         * `@flowmap.gl/data`, `@flowmap.gl/layers` and `@kepler.gl/utils` are
         * published as ESM ("type": "module") but their compiled output uses
         * extensionless relative imports (`export * from './types'`). That is
         * invalid ESM, so webpack 5's strict `fullySpecified` resolution refuses
         * to resolve them and the build fails with 21 "Can't resolve" errors.
         *
         * Relaxing `fullySpecified` for .js/.mjs lets webpack fall back to
         * extension guessing, which is how these packages are meant to be
         * consumed. Remove once upstream ships spec-compliant ESM.
         */
        {
          test: /\.m?js$/,
          resolve: { fullySpecified: false },
        },
      ],
    },
  });
};

export default config;
