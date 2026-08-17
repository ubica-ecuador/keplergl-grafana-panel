import { test, expect } from '@grafana/plugin-e2e';
import { Locator, Page } from '@playwright/test';

/**
 * kepler's dropdowns (layer type, field pickers, color palettes…) render
 * through its Portaled component: a react-modal mounted inside kepler's own
 * root with `position: fixed` coordinates measured against the viewport.
 * Inside a Grafana dashboard that root sits under `.react-grid-item`, whose
 * CSS transform (and the panel chrome's `contain`) re-bases fixed positioning
 * to the panel — so every dropdown opened from the side panel appeared shifted
 * down by the panel's viewport offset and was clipped at the panel's bottom
 * edge, often to complete invisibility.
 *
 * The fix (portaledBodyMount + webpack module replacement) re-parents the
 * portal to document.body, where fixed coordinates mean what kepler thinks
 * they mean. These tests pin the observable contract: a dropdown opens next
 * to its trigger, fully on-screen, and its options can actually be picked.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const TRIPS_PANEL = 'data-testid Panel header Kepler.gl — trips';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Measures through getBoundingClientRect instead of locator.boundingBox():
 * under software WebGL the render loop starves requestAnimationFrame, the
 * "stable" actionability check never satisfies, and boundingBox() times out
 * even on elements that are not moving at all.
 */
async function boxOf(locator: Locator): Promise<Box> {
  return locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/**
 * Clicks through the mouse instead of the locator so no actionability wait is
 * involved; the follow-up round trip proves the page processed the click
 * (see drawFilter.spec.ts / effects.spec.ts).
 */
async function clickCenter(page: Page, locator: Locator): Promise<void> {
  const box = await boxOf(locator);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await page.waitForTimeout(300);
}

async function openLayerTypeDropdown(page: Page, panel: Locator): Promise<Locator> {
  await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  // Let deck finish mounting its layers; a click during setup is dropped
  // (see drawFilter.spec.ts).
  await page.waitForTimeout(3000);

  // The layer type selector only exists once the layer's config is expanded.
  const typeTrigger = panel.locator('.layer-panel__config .item-selector__dropdown').first();
  if (!(await typeTrigger.isVisible())) {
    await clickCenter(page, panel.locator('.layer__enable-config').first());
  }
  await expect(typeTrigger).toBeVisible();

  // Under software WebGL a click can still be swallowed by a busy main
  // thread; each attempt toggles nothing unless it was actually processed, so
  // retry until the dropdown exists.
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickCenter(page, typeTrigger);
    try {
      await page.locator('.typeahead').waitFor({ state: 'visible', timeout: 3000 });
      return typeTrigger;
    } catch {
      // dropped click — try again
    }
  }
  await expect(page.locator('.typeahead')).toBeVisible();
  return typeTrigger;
}

test('opens the layer type dropdown next to its trigger and fully on-screen', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  // Two kepler maps per dashboard load, all rendered by software WebGL.
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId(TRIPS_PANEL);
  const typeTrigger = await openLayerTypeDropdown(page, panel);
  const triggerBox = await boxOf(typeTrigger);

  // The dropdown is portaled to document.body, so it is not under `panel`.
  const dropdown = page.locator('.typeahead');
  await expect(dropdown).toBeVisible();
  // Let the open transition (opacity + 14px slide) finish before measuring.
  await page.waitForTimeout(600);
  const dropdownBox = await boxOf(dropdown);

  // Adjacent to its trigger: kepler anchors the list at the trigger, nudging
  // it up only as far as needed to fit the window. When the portal was clipped
  // and re-based to the panel, the list opened a panel-offset (~150px+) lower.
  const gap = Math.max(
    triggerBox.y - (dropdownBox.y + dropdownBox.height),
    dropdownBox.y - (triggerBox.y + triggerBox.height)
  );
  expect(gap).toBeLessThan(60);

  // Fully on-screen: the broken portal pushed the tail of the list past the
  // panel's clip edge, so options at the bottom could never be seen or picked.
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error('no viewport size');
  }
  expect(dropdownBox.y).toBeGreaterThanOrEqual(0);
  expect(dropdownBox.y + dropdownBox.height).toBeLessThanOrEqual(viewport.height);
});

test('changes the layer type by picking a dropdown option', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  // Two kepler maps per dashboard load, all rendered by software WebGL.
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId(TRIPS_PANEL);
  const typeTrigger = await openLayerTypeDropdown(page, panel);

  // 'Point' names both the current selection in the trigger and its list
  // entry, so pick a type the trips layer is not using. Label text is
  // lowercase in the DOM; CSS capitalizes it for display.
  const option = page.locator('.typeahead .layer-type-selector__item__label', { hasText: /^arc$/i });
  await expect(option).toBeVisible();
  await page.waitForTimeout(600);
  await clickCenter(page, option);

  await expect(typeTrigger).toContainText(/arc/i);
});
