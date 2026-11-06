/*
 * A webpack loader for @kepler.gl/components' tileset-raster-form.js (Add Data
 * → Tileset → Raster Tile): the form uses the raster tile servers the panel is
 * given, and asks no one when it has none.
 *
 * kepler's form sends every Cloud Optimized GeoTIFF to Development Seed's
 * public server, `https://titiler.xyz`, hard-coded: about 300 ms after a COG
 * URL is typed it asks `https://titiler.xyz/cog/stac?url=<the COG>` for the
 * file's description, and it saves that server as the tileset's, whatever the
 * form's own "Raster tile servers" field says. The panel ships with no raster
 * server on purpose (src/panel/constants.ts, DEFAULT_RASTER_SERVER_URL), so a
 * user's imagery URL, signature included, never goes to a third party nobody
 * chose. Patched here:
 *
 *  - the constant is gone: no URL of a public server is left in the form;
 *  - a COG's description is asked of the first server in the form's field
 *    (which starts from kepler's `rasterServerUrls`: the panel's option, see
 *    src/panel/keplerConfig.ts `configureRasterServers`), as `<server>/cog/stac`;
 *    with no server, nothing is asked;
 *  - the tileset keeps the form's servers, COG or not;
 *  - with no server, a COG gets a message that says what to set.
 *
 * The form is not an injectable factory and its pieces are private to the
 * file, so the text is rewritten. Every piece it replaces is checked, not
 * assumed: a kepler release that changes one fails the build here instead of
 * quietly sending COGs to titiler.xyz again. `NoPublicTitilerPlugin` below is
 * the second line: it fails the build if any kepler module still holds the
 * server's URL as a value once the loaders have run, should kepler move the
 * form elsewhere or start asking the server from somewhere new.
 *
 * Self-contained on purpose, for a second webpack configuration that builds
 * this panel's source: add the rule `{ test: RASTER_FORM, use: [<this file>] }`
 * and the plugin `new NoPublicTitilerPlugin()`.
 */

/** The form, in kepler's esm and cjs builds. */
const RASTER_FORM =
  /[\\/]@kepler\.gl[\\/]components[\\/]dist[\\/](esm|cjs)[\\/]modals[\\/]tilesets-modals[\\/]tileset-raster-form\.js$/;

const PUBLIC_SERVER = 'https://titiler.xyz';

/** What the form says to a COG with no server to read it. */
const NO_SERVER_MESSAGE =
  'A Cloud Optimized GeoTIFF is drawn by a raster tile server (TiTiler), and none is set. ' +
  'Set "Raster tile server" in the panel options, or type one in "Raster tile servers" below. ' +
  'Nothing is sent anywhere until one is set.';

/** [what kepler wrote, what replaces it, how many times it appears]. */
const REPLACEMENTS = [
  [`var TITILER_BASE_URL = '${PUBLIC_SERVER}';`, "var TITILER_BASE_URL = '';", 1],
  [
    'function getCOGMetadataUrl(cogUrl) {\n  return "".concat(TITILER_BASE_URL, "/cog/stac?url=").concat(encodeURIComponent(cogUrl));\n}',
    [
      // The first server of a comma-separated list, as the form's field holds them.
      'function firstRasterServer(servers) {',
      "  var first = String(servers || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)[0];",
      "  return first ? first.replace(/\\/+$/, '') : '';",
      '}',
      'function getCOGMetadataUrl(cogUrl, servers) {',
      '  var server = firstRasterServer(servers);',
      '  return server ? "".concat(server, "/cog/stac?url=").concat(encodeURIComponent(cogUrl)) : \'\';',
      '}',
    ].join('\n'),
    1,
  ],
  [
    '  return isCOG ? getCOGMetadataUrl(url) : url;',
    '  return isCOG ? getCOGMetadataUrl(url, _ref2.servers) : url;',
    1,
  ],
  [
    '    url: clearedMetadataUrl,\n    isCOG: isCOG\n  });',
    '    url: clearedMetadataUrl,\n    isCOG: isCOG,\n    servers: rasterTileServerUrls\n  });',
    1,
  ],
  [
    'var effectiveRasterTileServerUrls = isCOG ? TITILER_BASE_URL : rasterTileServerUrls;',
    'var effectiveRasterTileServerUrls = rasterTileServerUrls;',
    1,
  ],
  // An empty field takes the panel's servers when a COG arrives, not the public one.
  ['setRasterTileServerUrls(TITILER_BASE_URL);', 'setRasterTileServerUrls(defaultServerUrls);', 3],
  [
    "error = new Error('Provide valid raster tile server urls to support STAC and elevations.');",
    `error = new Error(isCOG ? ${JSON.stringify(NO_SERVER_MESSAGE)} : 'Provide valid raster tile server urls to support STAC and elevations.');`,
    1,
  ],
];

function count(source, text) {
  let n = 0;
  for (let i = source.indexOf(text); i >= 0; i = source.indexOf(text, i + text.length)) {
    n++;
  }
  return n;
}

function patchRasterForm(source) {
  let patched = source;
  for (const [from, to, times] of REPLACEMENTS) {
    const found = count(patched, from);
    if (found !== times) {
      throw new Error(
        `kepler-raster-form-loader: expected ${times} of ${JSON.stringify(from.split('\n')[0])} in ` +
          `tileset-raster-form.js, found ${found}: kepler's raster tile form has changed`
      );
    }
    patched = patched.split(from).join(to);
  }
  if (patched.includes(PUBLIC_SERVER)) {
    throw new Error(`kepler-raster-form-loader: tileset-raster-form.js still names ${PUBLIC_SERVER}`);
  }
  return patched;
}

/** The public server's URL as a value of its own: `'https://titiler.xyz'`, or a request under it. */
const PUBLIC_SERVER_LITERAL = /["'`]https:\/\/titiler\.xyz\/?(?:["'`]|\/[a-z])/;

/**
 * Fails the build when any kepler module, after the loaders have run, still
 * holds the public server's URL as a value: kepler's raster form moved, or a
 * new piece of kepler started asking it. The panel's own help text, which
 * names the server for whoever wants to type it in, is not kepler's.
 */
class NoPublicTitilerPlugin {
  apply(compiler) {
    const { WebpackError } = compiler.webpack;
    compiler.hooks.thisCompilation.tap('NoPublicTitilerPlugin', (compilation) => {
      compilation.hooks.finishModules.tap('NoPublicTitilerPlugin', (modules) => {
        for (const module of modules) {
          const resource = module.resource;
          if (typeof resource !== 'string' || !/[\\/]@kepler\.gl[\\/]/.test(resource)) {
            continue;
          }
          const source = module.originalSource && module.originalSource();
          const text = source ? source.source().toString() : '';
          if (PUBLIC_SERVER_LITERAL.test(text)) {
            compilation.errors.push(
              new WebpackError(
                `NoPublicTitilerPlugin: ${resource} still sends requests to ${PUBLIC_SERVER}; ` +
                  "see scripts/kepler-raster-form-loader.cjs: kepler's raster tile form has moved or changed"
              )
            );
          }
        }
      });
    });
  }
}

module.exports = function keplerRasterFormLoader(source) {
  return patchRasterForm(source);
};
module.exports.patchRasterForm = patchRasterForm;
module.exports.RASTER_FORM = RASTER_FORM;
module.exports.NoPublicTitilerPlugin = NoPublicTitilerPlugin;
module.exports.NO_SERVER_MESSAGE = NO_SERVER_MESSAGE;
