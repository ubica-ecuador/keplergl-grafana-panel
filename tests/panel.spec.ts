import { test, expect } from '@grafana/plugin-e2e';

/**
 * Phase 0 coverage: the panel mounts kepler.gl and gets data into it.
 *
 * These assert on kepler's own DOM rather than on pixels — the map is WebGL and
 * screenshot comparison would be flaky across GPU/software-rendering setups.
 */

test('renders the kepler.gl map with the panel dataset loaded', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  // kepler draws into WebGL canvases once it has mounted.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  // The dataset reached kepler. If it had not, kepler would instead show its
  // empty-state "Add Data" modal.
  await expect(page.getByText('Spike data')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Drag & Drop Your File(s) Here')).toBeHidden();
});

test('keeps a hand-configured layer across a data refresh', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.getByText('Spike data')).toBeVisible({ timeout: 60_000 });

  // Rename the auto-created layer, then push new data through updateVisData.
  const layerName = page.locator('[class*="layer-panel"] input').first();
  await layerName.fill('KEEP-ME');
  await layerName.press('Enter');

  await page.getByTestId('spike-refresh').click();

  // The whole point of updateVisData + keepExistingConfig: the user's layer
  // configuration survives. The Foursquare plugin loses it on every refresh.
  await expect(layerName).toHaveValue('KEEP-ME');
});
