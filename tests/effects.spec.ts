import { test, expect } from '@grafana/plugin-e2e';
import { Locator, Page } from '@playwright/test';

/**
 * The effects button is host-app wiring, not stock kepler: the panel replaces
 * kepler's MapControlFactory to add it (see src/panel/effectsMapControl.tsx).
 * These tests pin the two halves of that wiring — the button reaching the
 * toolbar, and the EffectManager panel actually mounting when toggled — plus
 * the vendored thumbnails and config persistence it depends on.
 *
 * The dashboard has two kepler panels, so dashboard-view locators are scoped
 * to one of them, following drawFilter.spec.ts.
 */

// In the panel editor kepler's dropdowns can spill under Grafana's options
// pane on a small viewport, which playwright reports as an intercepted click.
test.use({ viewport: { width: 1920, height: 1080 } });

const TRIPS_PANEL = 'data-testid Panel header Kepler.gl — trips';

/**
 * Clicks through the mouse instead of the locator: under software WebGL the
 * render loop saturates the main thread, kepler's dropdown never reports
 * "stable", and locator.click() times out waiting for it. The follow-up
 * round trip proves the page processed the click (see drawFilter.spec.ts).
 */
async function clickCenter(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('element has no bounding box');
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await page.waitForTimeout(300);
}

test("shows the effects button and opens kepler's effect panel", async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId(TRIPS_PANEL);
  await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  const effectsButton = panel.locator('button.toggle-effect');
  await expect(effectsButton).toBeVisible();

  await effectsButton.click();
  await expect(panel.locator('.effect-manager-title')).toHaveText('Effects');

  // Toggling again unmounts the panel rather than merely hiding it.
  await effectsButton.click();
  await expect(panel.locator('.effect-manager')).toHaveCount(0);
});

test('serves the effect thumbnails from the plugin itself', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId(TRIPS_PANEL);
  await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  // Through the mouse: under software WebGL locator.click()'s stability wait
  // can time out on map-control buttons while the render loop is saturated.
  await clickCenter(page, panel.locator('button.toggle-effect'));
  await clickCenter(page, panel.locator('.effect-manager .effect-config__type'));
  // The type dropdown is portaled to document.body (see portaledBodyMount.tsx),
  // so its content is page-scoped, not under the panel.
  await expect(page.locator('.effect-type-selector__item__label').first()).toBeVisible();

  // kepler builds these URLs from `cdnUrl`, which keplerConfig.ts points at
  // the plugin's own assets so air-gapped installs never leave the host. A
  // broken vendored image renders as an empty frame without failing anything,
  // so assert on the loaded pixels, not on the DOM.
  const thumbnails = await page.locator('.typeahead [class*="effect-type"] img').evaluateAll((imgs) =>
    (imgs as HTMLImageElement[]).map((img) => ({
      src: img.src,
      loaded: img.complete && img.naturalWidth > 0,
    }))
  );
  expect(thumbnails.length).toBeGreaterThan(0);
  for (const thumbnail of thumbnails) {
    expect(thumbnail.src).toContain('/public/plugins/');
    expect(thumbnail.loaded).toBe(true);
  }
});

test('keeps added effects in the saved map configuration', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  // Save → apply → remount is the heaviest kepler flow under software WebGL.
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  await expect(page.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });

  await page.locator('button.toggle-effect').click();
  // The "add effect" dropdown appends an effect of the picked type.
  await clickCenter(page, page.locator('.effect-manager .effect-config__type'));
  await clickCenter(page, page.locator('.effect-type-selector__item__label').first());
  await expect(page.locator('.effect-panel-header')).toHaveCount(1);

  await page.getByTestId('save-map-config').click();
  await expect(page.getByText(/Saved:/)).toBeVisible({ timeout: 10_000 });

  // Applying remounts the panel from the saved options; the effect surviving
  // proves it went through the schema round-trip, not kepler's memory.
  await panelEditPage.apply();
  const panel = page.getByTestId(TRIPS_PANEL);
  await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await panel.locator('button.toggle-effect').click();
  await expect(panel.locator('.effect-panel-header')).toHaveCount(1, { timeout: 60_000 });
});
