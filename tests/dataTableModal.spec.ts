import { test, expect } from '@grafana/plugin-e2e';
import { Locator, Page } from '@playwright/test';

/**
 * kepler mounts its dialogs — the dataset's data table first among them — in
 * KeplerGl's own root, sized for a page: 90vw wide, 85vh tall, over a
 * `position: fixed` overlay. Inside a dashboard that root sits under a
 * transformed, clipping `.react-grid-item`, so the overlay covered the panel
 * alone and the dialog was cut at the panel's edges: the table could not be
 * read, and on a panel narrower than the page its close button was cut off,
 * leaving an overlay that swallowed every click on the map for good.
 *
 * The fix (modalOnBody.tsx, a recipe in keplerRecipes.ts) mounts the dialog on
 * document.body. These tests pin what a viewer sees: a dialog over the whole
 * page, nothing of it cut, and a close button that closes it.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const TRIPS_PANEL = 'data-testid Panel header Kepler.gl — trips';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** getBoundingClientRect, not boundingBox(): see dropdownPlacement.spec.ts. */
async function boxOf(locator: Locator): Promise<Box> {
  return locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** A mouse click and a frame's round trip, no actionability wait: see dropdownPlacement.spec.ts. */
async function clickCenter(page: Page, locator: Locator): Promise<void> {
  const box = await boxOf(locator);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await page.waitForTimeout(300);
}

/** Whether what the page would hit at (x, y) is `locator`'s element or inside it: visible there, and not clipped. */
async function hitsAt(locator: Locator, x: number, y: number): Promise<boolean> {
  return locator.first().evaluate(
    (el, [px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return hit !== null && el.contains(hit);
    },
    [x, y]
  );
}

async function openDataTable(page: Page, panel: Locator): Promise<Locator> {
  await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  // A click during deck's setup is dropped (see drawFilter.spec.ts).
  await page.waitForTimeout(3000);

  const dialog = page.locator('.ReactModal__Content').filter({ has: page.locator('.dataset-modal') });
  // Under software WebGL a click can still be swallowed by a busy main thread.
  for (let attempt = 0; attempt < 3 && !(await dialog.isVisible()); attempt++) {
    await clickCenter(page, panel.locator('.show-data-table svg').first());
  }
  await expect(dialog).toBeVisible();
  // The overlay fades in; let it settle before measuring.
  await page.waitForTimeout(600);
  return dialog;
}

test('opens the data table over the whole page, nothing of it cut by the panel', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  // Two kepler maps per dashboard load, all rendered by software WebGL.
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId(TRIPS_PANEL);
  const dialog = await openDataTable(page, panel);

  // Not under the panel, whose transformed grid item clipped it.
  expect(await panel.locator('.dataset-modal').count()).toBe(0);

  // The overlay is the page's, not the panel's.
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error('no viewport size');
  }
  const overlay = await boxOf(page.locator('.ReactModal__Overlay').filter({ has: page.locator('.dataset-modal') }));
  expect(overlay.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(overlay.height).toBeGreaterThanOrEqual(viewport.height - 1);

  // The table's corners are where kepler drew them, and the page hits them
  // there: a clipped dialog hands those points to whatever lies beneath.
  const table = page.locator('.dataset-modal');
  const box = await boxOf(table);
  expect(box.width).toBeGreaterThan(viewport.width * 0.8);
  expect(await hitsAt(table, box.x + 10, box.y + 10)).toBe(true);
  expect(await hitsAt(table, box.x + box.width - 10, Math.min(box.y + box.height, viewport.height) - 10)).toBe(true);

  await expect(dialog.locator('.modal--close')).toBeVisible();
});

test('closes the data table from its close button, and the map takes clicks again', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId(TRIPS_PANEL);
  const dialog = await openDataTable(page, panel);

  const close = dialog.locator('.modal--close');
  const closeBox = await boxOf(close);
  expect(await hitsAt(close, closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2)).toBe(true);
  await clickCenter(page, close);

  await expect(page.locator('.dataset-modal')).toHaveCount(0);
  // No overlay left over the map.
  const canvas = panel.locator('canvas').first();
  const canvasBox = await boxOf(canvas);
  expect(await hitsAt(panel, canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)).toBe(true);
});
