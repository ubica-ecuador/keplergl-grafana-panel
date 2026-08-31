import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';
import path from 'path';
import webpack, { type Configuration } from 'webpack';
import { merge } from 'webpack-merge';

import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

/*
 * Walks up from `context` (the directory of the file issuing a bare
 * `require('mapbox-gl')` / `import('mapbox-gl')`) the same way Node's
 * module resolution does, finds the *first* `node_modules/mapbox-gl` on
 * that path, and reports whether ITS version is the proprietary line —
 * major version 2 or above, which is where Mapbox moved off BSD-3 onto
 * its own TOS. 1.x is the last open-source line, so major < 2 is let through.
 *
 * The test is deliberately on the resolved package's *version*, not on
 * whether its path equals some known top-level location. `mapbox-gl` is
 * not a direct dependency of this plugin — it doesn't appear in
 * package.json at all — it sits wherever npm's hoisting happens to park
 * it, currently the repo root, as a side effect of react-map-gl's peer
 * dependency on it. A path-based test ("is this the top-level copy?")
 * would silently stop excluding the proprietary copy the moment an
 * unrelated lockfile change re-nests it somewhere else (say, under
 * @hubble.gl/react, if a version conflict ever forces that) — the
 * exclusion would keep compiling, keep passing every existing test, and
 * the Mapbox-TOS code would quietly come back into the published
 * archive with nothing here to notice. Testing the version instead is
 * immune to hoisting: wherever npm parks the 2.x-or-later copy, this
 * excludes it; wherever the BSD-3 1.13.1 copy lives, this leaves it
 * alone. (See the CI step "Guard against proprietary mapbox-gl
 * re-entering the bundle" for the second, independent line of defence —
 * a build-time content check in case this one is ever bypassed too.)
 */
const resolvesToProprietaryMapboxGl = (context: string): boolean => {
  let dir = context;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', 'mapbox-gl');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8')) as {
          version?: string;
        };
        const major = Number.parseInt(pkg.version ?? '', 10);
        return Number.isFinite(major) && major >= 2;
      } catch {
        return false; // can't read/parse its package.json — don't touch it
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return false; // reached the filesystem root without finding a mapbox-gl at all
    }
    dir = parent;
  }
};

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
          /*
           * The notices for the compiled third-party code in the bundle. The
           * scaffold copies LICENSE, README and CHANGELOG from the repository
           * root; this one is ours to place. `dist/LICENSE.txt` is terser's
           * extraction of banner comments and covers only the packages that
           * happen to carry one — kepler.gl, deck.gl and the vendored assets
           * do not.
           */
          { from: '../THIRD-PARTY-LICENSES.md', to: 'THIRD-PARTY-LICENSES.md' },
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
      /*
       * `mapbox-gl` 3.x is proprietary: its LICENSE.txt puts it "under the
       * Mapbox TOS for use only with the relevant Mapbox product(s) ...
       * requires a current active Mapbox account", which cannot be
       * redistributed inside this Apache-2.0 plugin on Grafana's catalog.
       *
       * It reaches the bundle only through kepler's lazy base-map-library
       * loader — `baseMapLibraryConfig.mapbox.getMapLib: () =>
       * import('mapbox-gl')` in @kepler.gl/utils/application-config.js —
       * which map-container.js only calls when the *selected* map style
       * declares Mapbox as its base map library. This plugin ships MapLibre
       * styles only (see src/panel/basemaps.ts and constants.ts) and never
       * selects a Mapbox-backed one, so that branch never runs. webpack
       * doesn't know that at build time, though: it still follows the
       * static `import('mapbox-gl')` and emits the package as its own
       * chunk regardless of whether the code path that awaits it executes.
       *
       * Two unrelated copies of the package sit in the tree under the same
       * name "mapbox-gl": the proprietary 3.28.1 above (a hoisting
       * artifact of react-map-gl's peer dependency — not in package.json
       * at all, currently the repo root but not pinned there), and a
       * second, license-clean 1.13.1 (BSD-3-Clause) that npm nested under
       * @kepler.gl/{utils,components}/node_modules because it satisfies
       * kepler's own pinned dependency there. Both are reached by the
       * identical bare specifier, resolved to different files only by
       * which directory the importing file sits in (Node's node_modules
       * walk finds kepler's own nested copy first for kepler's files, and
       * falls through to whichever copy npm hoisted for anything
       * importing "mapbox-gl" without a nested copy of its own). A plain
       * `resolve.alias: {'mapbox-gl$': false}` matches on the specifier
       * text, not on which file it resolves to — tried and verified empirically
       * that it silently takes out BOTH: dist/32.js (the BSD-3 copy) and
       * dist/662.js (this one) both collapsed to near-empty stub chunks.
       * IgnorePlugin's `checkResource` instead runs with the *issuing*
       * file's directory as `context`, so `resolvesToProprietaryMapboxGl`
       * (above) can redo that same node_modules walk per call site and
       * ignore the request only when the copy it lands on reports itself
       * as major version 2+ — leaving the nested 1.13.1, and dist/32.js,
       * untouched regardless of where npm's hoisting puts either copy.
       */
      new webpack.IgnorePlugin({
        checkResource: (resource, context) => resource === 'mapbox-gl' && resolvesToProprietaryMapboxGl(context),
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
