import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import stacFixture from './mocks/cog-float32-stac.json';

import { settle } from './keplerHelpers';

/**
 * A float32 raster reaches the tile server at all.
 *
 * kepler gave up on any data type without a fixed maximum — `dtypeMaxValue`
 * holds `null` for every float — and returned no pixel range, so the layer
 * mounted and then asked for nothing: no tiles, no error, an empty map. The
 * range for those types has to come from the band statistics the STAC metadata
 * carries, which is what `getPixelRange` now reads.
 *
 * What is pinned here is that first half, because it is the half a browser can
 * observe: a float32 scene whose STAC declares statistics produces `.npy` tile
 * requests. The second half — the float mask discarding every valid pixel,
 * because its "no upper bound" default sat below the FLT_MAX a mask marks valid
 * data with — happens inside a shader, and this suite does not compare
 * screenshots (see `panel.spec.ts` on why). It was verified by hand against a
 * real TiTiler; both fixes travel together.
 *
 * Both were carried as local patches until kepler.gl 3.3.0-alpha.11, which is
 * the first release to ship them; this spec now guards the upstream code rather
 * than a patch of ours.
 *
 * Upstream: https://github.com/keplergl/kepler.gl/pull/3704
 */

test.use({ viewport: { width: 1600, height: 1000 } });

// Loading kepler and reaching for a tile does not fit in playwright's default half minute.
test.describe.configure({ timeout: 120_000 });

const SCENE = 'https://example.test/ndvi-float32.tif';

/**
 * TiTiler's own answer for a single-band float32 COG, kept as it came off the
 * server with only the href pointed at a host that does not resolve.
 *
 * Not written by hand, because a document can carry everything kepler reads and
 * still be thrown away: `parseRasterMetadata` requires the **eo and raster
 * extensions to be declared** in `stac_extensions` (or STAC 1.1 core `bands`),
 * and `dataset-utils` swallows the error it returns. Drop the eo entry from this
 * fixture and the spec fails exactly as it does unpatched — same silence, wrong
 * reason.
 */
const STAC = stacFixture;

/** The statistics are what makes a float32 band drawable; kepler has no other range for it. */
const STATISTICS = STAC.assets.data['raster:bands'][0].statistics;

/** Largest float32, which is how a mask of that type marks a pixel as valid data. */
const FLOAT32_MAX = 3.4028234663852886e38;

/**
 * A `.npy` tile of one float32 band plus its mask, the two planes rio-tiler
 * returns for `return_mask=true`. The format is a short ASCII header padded to a
 * 64-byte boundary, then the raw little-endian values.
 */
function npyTile(size = 8): Buffer {
  const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (2, ${size}, ${size}), }`;
  const padding = 64 - ((10 + header.length + 1) % 64);
  const head = Buffer.from(header + ' '.repeat(padding) + '\n', 'latin1');

  const prologue = Buffer.alloc(10);
  prologue.write('\x93NUMPY', 0, 'latin1');
  prologue.writeUInt8(1, 6);
  prologue.writeUInt8(0, 7);
  prologue.writeUInt16LE(head.length, 8);

  const values = new Float32Array(2 * size * size);
  for (let i = 0; i < size * size; i++) {
    // A ramp across the range the statistics declare, and a mask that keeps it all.
    values[i] = STATISTICS.minimum + (i / (size * size - 1)) * (STATISTICS.maximum - STATISTICS.minimum);
    values[size * size + i] = FLOAT32_MAX;
  }

  return Buffer.concat([prologue, head, Buffer.from(values.buffer)]);
}

/** Serves the metadata and the tiles from the test, and records what was asked of it. */
async function stubTiler(page: Page): Promise<{ stac: string[]; tiles: string[] }> {
  const asked = { stac: [] as string[], tiles: [] as string[] };
  const tile = npyTile();

  await page.route(/titiler\.test\/cog\/stac/, (route) => {
    asked.stac.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STAC) });
  });

  await page.route(/titiler\.test\/cog\/tiles\//, (route) => {
    asked.tiles.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/x-binary', body: tile });
  });

  return asked;
}

test('asks for tiles of a float32 scene, whose range only the STAC statistics carry', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page);
  const dashboard = await readProvisionedDashboard({ fileName: 'rasterFloat32.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);

  // Unpatched, this stays at zero for ever: no pixel range, so the layer never
  // reaches the network and says nothing about it.
  await expect.poll(() => asked.tiles.length, { timeout: 60_000 }).toBeGreaterThan(0);

  expect(asked.stac.length).toBeGreaterThan(0);
  expect(asked.tiles.every((url) => url.includes('.npy'))).toBe(true);
  expect(asked.tiles.every((url) => decodeURIComponent(url).includes(SCENE))).toBe(true);
});
