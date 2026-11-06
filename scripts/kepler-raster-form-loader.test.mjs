import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { patchRasterForm, RASTER_FORM, NO_SERVER_MESSAGE } = require('./kepler-raster-form-loader.cjs');

// The package exports no package.json; its main entry is dist/cjs/index.js.
const dist = path.resolve(path.dirname(require.resolve('@kepler.gl/components')), '..');
const form = (kind) => path.join(dist, kind, 'modals', 'tilesets-modals', 'tileset-raster-form.js');

/** The patched form's URL helpers, run on their own: they use nothing but their arguments. */
function urlHelpers(kind) {
  const patched = patchRasterForm(fs.readFileSync(form(kind), 'utf8'));
  const start = patched.indexOf('var TITILER_BASE_URL');
  const end = patched.indexOf('var RASTER_TILE_EXAMPLES');
  assert.ok(start >= 0 && end > start);
  return new Function(`${patched.slice(start, end)}; return { getEffectiveRasterMetadataUrl };`)();
}

const COG = 'https://bucket.example/scene/TCI.tif';

for (const kind of ['esm', 'cjs']) {
  describe(`kepler's raster tile form (${kind})`, () => {
    test('is the file the rule matches', () => {
      assert.match(form(kind), RASTER_FORM);
    });

    test('names no public server once patched', () => {
      const patched = patchRasterForm(fs.readFileSync(form(kind), 'utf8'));
      assert.ok(!patched.includes('titiler.xyz'));
      assert.ok(patched.includes(JSON.stringify(NO_SERVER_MESSAGE)));
    });

    test("asks a COG's description of the form's first server, and of no one without one", () => {
      const { getEffectiveRasterMetadataUrl } = urlHelpers(kind);

      assert.equal(getEffectiveRasterMetadataUrl({ probing: false, url: COG, isCOG: true, servers: '' }), '');
      assert.equal(getEffectiveRasterMetadataUrl({ probing: false, url: COG, isCOG: true, servers: ' , ' }), '');
      assert.equal(
        getEffectiveRasterMetadataUrl({
          probing: false,
          url: COG,
          isCOG: true,
          servers: 'https://tiler.internal/, https://second.internal',
        }),
        `https://tiler.internal/cog/stac?url=${encodeURIComponent(COG)}`
      );
      // A STAC item or a .pmtiles is its own description, as before.
      const stac = 'https://stac.example/items/1';
      assert.equal(getEffectiveRasterMetadataUrl({ probing: false, url: stac, isCOG: false, servers: '' }), stac);
      assert.equal(getEffectiveRasterMetadataUrl({ probing: true, url: COG, isCOG: true, servers: 'https://t' }), '');
    });
  });
}

test('a form kepler has changed fails the build rather than going through unpatched', () => {
  const source = fs.readFileSync(form('esm'), 'utf8');
  assert.throws(
    () => patchRasterForm(source.replace('isCOG ? TITILER_BASE_URL : rasterTileServerUrls', 'TITILER_BASE_URL')),
    /kepler's raster tile form has changed/
  );
  assert.throws(() => patchRasterForm(`${source}\nfetch('https://titiler.xyz/x');`), /still names/);
});
