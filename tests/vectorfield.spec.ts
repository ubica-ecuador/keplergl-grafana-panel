import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { readFlowField, readVectorField, settle } from './keplerHelpers';

/** A full kepler map under swiftshader: see `flowfield.spec.ts` for the budget. */
test.describe.configure({ timeout: 180_000 });

/**
 * Clicks through the mouse, like `effects.spec.ts`: under software WebGL the
 * render loop keeps kepler's dropdowns from ever reporting themselves stable.
 */
async function clickCenter(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('element has no bounding box');
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Picks an option of one of the layer panel's own selectors, found by its label. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  // Matched whole: "Symbol" would otherwise also find the "Symbols" group, and a
  // locator that resolves to two elements fails Playwright's strict mode.
  const selector = page
    .locator('label.side-panel-panel__label', { hasText: new RegExp(`^${label}$`) })
    .first()
    .locator('xpath=following::div[contains(@class,"item-selector__dropdown")][1]');
  await clickCenter(page, selector);
  await clickCenter(page, page.locator('.list__item', { hasText: option }).first());
}

test(
  'turns the flow field into a vector field that keeps its columns and draws arrows and barbs',
  async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
    test.slow();
    const dashboard = await readProvisionedDashboard({ fileName: 'flowfield.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

    const map = panelEditPage.panel.locator.locator('canvas').first();
    await expect(map).toBeVisible({ timeout: 60_000 });
    await settle(page);
    await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);

    // Switch the type from the layer's own panel. kepler keeps every key the new
    // layer also has, so the columns and the mode survive the switch.
    await page.locator('.layer-panel__header__content').first().dispatchEvent('click');
    await clickCenter(page, page.locator('.layer-config__type').first());
    await clickCenter(page, page.locator('.layer-type-selector__item', { hasText: 'Vector field' }).first());

    await expect.poll(async () => (await readVectorField(map))?.symbols ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
    const switched = (await readVectorField(map))!;
    expect(switched.columnMode).toBe('components');
    expect(switched.columns).toMatchObject({ u: 'u', v: 'v' });
    // The screen grid needs the camera, which only arrives if the panel counts
    // this layer among the ones it describes the map to.
    await expect.poll(async () => (await readVectorField(map))?.hasCamera, { timeout: 30_000 }).toBe(true);

    // On the data's own nodes there is one symbol per sample: the grid is 7 × 7.
    await choose(page, 'Placement', 'Data cells');
    await expect.poll(async () => (await readVectorField(map))?.symbols, { timeout: 30_000 }).toBe(49);

    // Barbs: every key asked for is in the atlas, and the field sits in Ecuador,
    // south of the equator, so every barb is the southern one.
    await choose(page, 'Symbol', 'Wind barb');
    await expect
      .poll(async () => (await readVectorField(map))?.iconKeys.every((key) => key === 'calm' || key.endsWith('-s')), {
        timeout: 30_000,
      })
      .toBe(true);
    const barbs = (await readVectorField(map))!;
    expect(barbs.iconKeys.length).toBeGreaterThan(0);
    expect(barbs.iconKeys.every((key) => barbs.atlasKeys.includes(key))).toBe(true);
  }
);
