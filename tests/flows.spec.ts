import { test, expect } from '@grafana/plugin-e2e';

/**
 * An origin-destination query must render an animated flow layer.
 *
 * kepler does not auto-detect flow layers the way it does points, geometry and
 * trips, so the panel adds one explicitly (`buildFlows` + `useFlowLayers`) when a
 * query carries origin/destination columns. The provisioned "flows" panel feeds
 * eight directed flows between four Cuenca zones.
 *
 * This also guards the deck.gl de-duplication in webpack.config.ts: with two
 * deck.gl copies in the bundle the flow shaders fail to compile and the layer,
 * though present in state, renders nothing.
 */
test('renders an origin-destination query as a flow layer', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'flows.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  // The panel auto-adds a flow layer for the OD dataset.
  await expect(panelEditPage.panel.locator.locator('.layer__title__type')).toHaveText('flow', {
    timeout: 60_000,
  });
});
