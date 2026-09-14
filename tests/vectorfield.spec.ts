import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { readFlowField, readVectorField, settle } from './keplerHelpers';

/** A full kepler map under swiftshader: see `flowfield.spec.ts` for the budget. */
test.describe.configure({ timeout: 180_000 });

/**
 * Clicks a side-panel control through Playwright's own `locator.click()`.
 *
 * Every control this spec clicks — the layer type selector, its options, the
 * item-selector dropdowns — sits in kepler's side panel, off to the side of
 * the map canvas, not over it. Nothing there is being repainted every frame,
 * so `locator.click()`'s actionability wait (visible, stable, receiving
 * events) settles almost immediately and the click is reliable. That is not
 * true of a control layered over the map itself — see `effects.spec.ts`,
 * where the target sits on top of the continuously repainting canvas and a
 * raw coordinate click is used instead, because there the actionability wait
 * can stall on an element that never reports itself stable. Confusing the
 * two here bit us once: a one-shot `page.mouse.click` at a computed centre
 * can land between two repaints of the map elsewhere on the page and miss
 * its target's hit-test entirely, with no error — `locator.click()` doesn't
 * have that gap, since it re-checks the element is actually there to be
 * clicked immediately before clicking it.
 */
async function click(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  await locator.click({ timeout: 30_000 });
}

/** Picks an option of one of the layer panel's own selectors, found by its label. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  // Matched whole: "Symbol" would otherwise also find the "Symbols" group, and a
  // locator that resolves to two elements fails Playwright's strict mode.
  const selector = page
    .locator('label.side-panel-panel__label', { hasText: new RegExp(`^${label}$`) })
    .first()
    .locator('xpath=following::div[contains(@class,"item-selector__dropdown")][1]');
  await click(selector);
  await click(page.locator('.list__item', { hasText: option }).first());
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
    //
    // Dispatched rather than clicked, like `flowfield.spec.ts`: the header is
    // mostly the layer's name field, so a real pointer lands in that input and
    // only focuses it; kepler's expand handler sits on the container around it.
    await page.locator('.layer-panel__header__content').first().dispatchEvent('click');
    await click(page.locator('.layer-config__type').first());
    await click(page.locator('.layer-type-selector__item', { hasText: 'Vector field' }).first());

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
