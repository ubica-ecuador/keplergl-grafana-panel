import { test, expect } from '@grafana/plugin-e2e';

/**
 * The interval only means something while the window is published during
 * playback, so the editor hides it until then, and it opens on the pace
 * playback always had.
 */
test('the playback interval shows only while publishing during playback', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'timevars.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const map = panelEditPage.getCustomOptions('Map');
  if (!(await map.isExpanded())) {
    await map.expand();
  }

  const interval = map.getNumberInput('Minimum interval while playing (ms)');
  await expect(interval).toBeHidden();
  await map.getSwitch('Update variables while playing').check();
  await expect(interval).toBeVisible();
  await expect(interval).toHaveValue('1500');
});
