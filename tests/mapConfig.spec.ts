import { test, expect } from '@grafana/plugin-e2e';

/**
 * The saved map configuration is what makes the panel usable beyond a single
 * session: without it every dashboard reload throws away the layers, colours
 * and filters the user set up.
 */
test('saves the map configuration into the panel options and restores it', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  await expect(page.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  await expect(page.getByText('Nothing saved yet')).toBeVisible();

  // Rename the auto-created layer so there is a change worth persisting.
  const layerName = page.locator('[class*="layer-panel"] input').first();
  await layerName.fill('Recorridos');
  await layerName.press('Enter');

  await page.getByTestId('save-map-config').click();

  // The panel writes the captured config back into the options, which the
  // editor reflects — proof the capture actually reached the panel model. Two
  // layers because table trip mode keeps the point layer alongside the trip.
  await expect(page.getByText(/Saved: 2 layers/)).toBeVisible({ timeout: 10_000 });

  // Applying returns to the dashboard, which remounts the panel from the
  // options — so the layer name coming back proves the restore path works, not
  // just that kepler still holds the state in memory.
  await panelEditPage.apply();
  await expect(page.locator('[class*="layer-panel"] input').first()).toHaveValue('Recorridos', {
    timeout: 60_000,
  });
});

test('rejects pasted JSON that is not a kepler configuration', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });

  await page.getByTestId('map-config-input').fill('{"totally":"wrong"}');
  await page.getByRole('button', { name: 'Import' }).click();

  await expect(page.getByText(/Not a kepler.gl configuration/)).toBeVisible();
});
