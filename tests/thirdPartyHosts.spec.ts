import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

/**
 * Two of kepler's dialogs that called third-party hosts on their own, as the
 * panel ships them.
 *
 * - Add Data → Tileset → Raster Tile sent every Cloud Optimized GeoTIFF to
 *   Development Seed's public TiTiler (`https://titiler.xyz/cog/stac?url=…`)
 *   about 300 ms after it was typed. It now asks the panel's *Raster tile
 *   server*, and no one when none is set.
 * - Share → Export Map fetched three preview pictures from CloudFront as it
 *   opened, for an HTML export that loads kepler.gl from CDNs. It now offers
 *   JSON only and fetches nothing.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const COG = 'https://imagery.kepler-grafana.test/scenes/36QWD/TCI.tif';
const SERVER = 'https://tiler.kepler-grafana.test';
/** A STAC item, as TiTiler's `/cog/stac` describes a COG. */
const STAC_ITEM = {
  type: 'Feature',
  stac_version: '1.0.0',
  id: 'TCI',
  bbox: [32, 15, 33, 16],
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [32, 15],
        [33, 15],
        [33, 16],
        [32, 16],
        [32, 15],
      ],
    ],
  },
  properties: { datetime: '2020-07-01T00:00:00Z' },
  assets: { data: { href: COG, type: 'image/tiff; application=geotiff; profile=cloud-optimized', roles: ['data'] } },
  links: [],
};

/** Every request the page makes that is not to Grafana. */
function outbound(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/titiler|cloudfront|unpkg\.com|esm\.sh|kepler-grafana\.test/.test(url)) {
      seen.push(url);
    }
  });
  return seen;
}

async function openRasterTileForm(page: Page): Promise<Locator> {
  await page.locator('button.add-data-button').click();
  await page.locator('.load-data-modal__tab__item', { hasText: 'Tileset' }).click();
  await page.getByText('Raster Tile', { exact: true }).click();
  const url = page.locator('#tile-metadata');
  await expect(url).toBeVisible();
  return url;
}

test('the raster tile form asks no one about a COG when the panel names no server', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const seen = outbound(page);
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });
  await expect(page.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });

  const url = await openRasterTileForm(page);
  await expect(page.locator('#tileset-raster-servers')).toHaveValue('');
  await url.fill(COG);
  await expect(page.getByText(/is drawn by a raster tile server \(TiTiler\), and none is set/)).toBeVisible({
    timeout: 10_000,
  });
  // Well past kepler's 300 ms debounce.
  await page.waitForTimeout(2000);
  await expect(page.locator('#tileset-raster-servers')).toHaveValue('');
  expect(seen).toEqual([]);
});

test("the raster tile form asks the panel's raster tile server about a COG", async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const seen = outbound(page);
  await page.route(`${SERVER}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STAC_ITEM) })
  );
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  await expect(page.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  await panelEditPage.getCustomOptions('Map').getTextInput('Raster tile server').fill(SERVER);
  await page.keyboard.press('Tab');

  const url = await openRasterTileForm(page);
  await expect(page.locator('#tileset-raster-servers')).toHaveValue(SERVER);
  await url.fill(COG);
  await expect.poll(() => seen, { timeout: 10_000 }).toContain(`${SERVER}/cog/stac?url=${encodeURIComponent(COG)}`);
  await page.waitForTimeout(1000);
  expect(seen.filter((u) => !u.startsWith(`${SERVER}/`) && !u.startsWith(COG))).toEqual([]);
});

test('Export Map offers JSON only and fetches nothing', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const seen = outbound(page);
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });
  await expect(page.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });

  // Share → Export Map, through kepler's own action.
  await page.locator('.maplibregl-map').evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    while (fiber && !(fiber.memoizedProps?.store && typeof fiber.memoizedProps.store.getState === 'function')) {
      fiber = fiber.return;
    }
    const store = fiber?.memoizedProps?.store;
    const instanceId = Object.keys(store.getState().keplerGl)[0];
    const action = { type: '@@kepler.gl/TOGGLE_MODAL', payload: 'exportMap' };
    store.dispatch({
      type: action.type,
      payload: { ...action, meta: { _id_: instanceId } },
      meta: { _forward_: '@redux-forward/FORWARD', _addr_: `@@KG_${instanceId.toUpperCase()}` },
    });
  });
  const dialog = page.locator('.export-map-modal');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.locator('[role="group"] button')).toHaveText(['json']);
  await expect(dialog.locator('img')).toHaveCount(0);
  await page.waitForTimeout(2000);
  expect(seen).toEqual([]);

  // Export writes kepler's JSON.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});
