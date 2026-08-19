import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { readKepler } from './keplerHelpers';

/**
 * A tileset added through kepler's own Add Data is a kepler *dataset*, not just
 * a layer: its whole content is a URL, and it lives nowhere but in kepler's
 * store. Saving only the config therefore brought the layer back pointing at a
 * dataset nothing provided, and it vanished on the way back to the dashboard.
 *
 * These pin the round trip: the descriptor reaches the panel options on save,
 * and the load path re-registers it so the layer binds again after a remount.
 *
 * The tile host is stubbed, so the suite still makes no outbound call — which
 * is the same premise that keeps these layers out of the gallery dashboard.
 */

// kepler's modals are tall; on a small viewport the "Add Tileset" button in the
// footer lands off-screen and playwright reports the click as intercepted.
test.use({ viewport: { width: 1920, height: 1080 } });

const TRIPS_PANEL = 'data-testid Panel header Kepler.gl — trips';

const TILE_HOST = 'https://tiles.kepler-grafana.test';
const TILE_URL = `${TILE_HOST}/vt/{z}/{x}/{y}.pbf`;
/** What kepler's `getMetaUrl` derives from the tile URL: the base plus metadata.json. */
const METADATA_URL = `${TILE_HOST}/vt/metadata.json`;

/**
 * TileJSON with its fields declared up front.
 *
 * `getFieldsFromTile` only downloads a tile when the metadata carries no
 * fields, so declaring them keeps the whole flow to a single stubbed request.
 */
const TILE_JSON = {
  tilejson: '2.2.0',
  name: 'Test Tileset',
  minzoom: 0,
  maxzoom: 4,
  bounds: [-125, 25, -66, 50],
  center: [-95, 37, 3],
  vector_layers: [{ id: 'population', fields: { population: 'Number', state: 'String' } }],
};

/**
 * Serves the tile host from the test.
 *
 * Registration order matters: playwright tries routes most-recently-added
 * first, so the metadata handler has to come after the catch-all it overrides.
 */
async function stubTileHost(page: Page): Promise<void> {
  await page.route(`${TILE_HOST}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: '' })
  );
  await page.route(METADATA_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TILE_JSON) })
  );
}

/** Drives kepler's Add Data → Tileset → Vector Tile form to the end. */
async function addVectorTileset(page: Page): Promise<void> {
  await page.locator('button.add-data-button').click();
  await page.locator('.load-data-modal__tab__item', { hasText: 'Tileset' }).click();

  // Vector Tile is the form the tileset tab opens on. Filling the tile URL is
  // what makes kepler derive and probe the metadata URL, so wait for that to
  // land rather than typing it — the probe is the step that can fail.
  await page.locator('#tile-url').fill(TILE_URL);
  await expect(page.locator('#tile-metadata')).toHaveValue(METADATA_URL, { timeout: 30_000 });
  // The name comes back from the metadata, which is also the signal it parsed.
  await expect(page.locator('#tileset-name')).toHaveValue(TILE_JSON.name, { timeout: 30_000 });

  // Dispatched rather than clicked: kepler's modal footer is laid out below a
  // 440px-min-height dialog and spills out of the panel box, so in the panel
  // editor this button lands over Grafana's Monaco query editor and playwright
  // reports every click as intercepted. Where the button sits is not what this
  // test is about.
  await page.getByRole('button', { name: 'Add Tileset' }).dispatchEvent('click');
}

test('keeps a tileset added in kepler in the saved map configuration', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  // Save → apply → remount is the heaviest kepler flow under software WebGL.
  test.slow();
  await stubTileHost(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  await expect(page.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });

  await addVectorTileset(page);

  // kepler auto-creates the layer for a tileset, so both halves land at once.
  const editorMap = page.locator('.maplibregl-map');
  await expect
    .poll(async () => (await readKepler(editorMap)).datasets.filter((d) => d.type === 'vector-tile').length, {
      timeout: 30_000,
    })
    .toBe(1);
  const added = await readKepler(editorMap);
  expect(added.layers.some((l) => l.type === 'vectorTile')).toBe(true);

  await page.getByTestId('save-map-config').click();
  // The count is the panel's only feedback that the descriptor — not just the
  // layer that references it — reached the options.
  await expect(page.getByText(/Saved: .*, 1 tileset\./)).toBeVisible({ timeout: 10_000 });

  // Applying rebuilds the panel from the options: the dataset surviving proves
  // it went through the save/restore round trip, not kepler's memory.
  await panelEditPage.apply();
  const panel = page.getByTestId(TRIPS_PANEL);
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(async () => (await readKepler(map)).datasets.filter((d) => d.type === 'vector-tile').length, {
      timeout: 60_000,
    })
    .toBe(1);
  const restored = await readKepler(map);
  expect(restored.layers.some((l) => l.type === 'vectorTile')).toBe(true);
  // The query datasets have to survive alongside it — the tileset rides in the
  // same addDataToMap payload as the rows.
  expect(restored.datasets.some((d) => d.type === '')).toBe(true);
});
