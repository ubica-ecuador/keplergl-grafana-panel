import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { projectRows, readKepler, readPictureDeck, readSymbolLayer, settle } from './keplerHelpers';

/** A full kepler map under swiftshader: see `flowfield.spec.ts` for the budget. */
test.describe.configure({ timeout: 180_000 });

/**
 * Clicks a side-panel control with `locator.click()`, never at coordinates.
 * `vectorfield.spec.ts` explains why that matters for controls beside the map.
 */
async function click(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  await locator.click({ timeout: 30_000 });
}

/**
 * Opens the layer's own panel.
 *
 * Dispatched rather than clicked, like `vectorfield.spec.ts`: the header is
 * mostly the layer's name field, so a real pointer lands in that input and only
 * focuses it, while kepler's expand handler sits on the container around it.
 */
async function openLayerPanel(page: Page): Promise<void> {
  await page.locator('.layer-panel__header__content').first().dispatchEvent('click');
}

/** One of the symbol layer's groups — Symbol, Rotation, Size — found by its label. */
function group(page: Page, label: string): Locator {
  return page
    .locator('.layer-config-group')
    .filter({ has: page.locator('.layer-config-group__label', { hasText: new RegExp(`^${label}$`) }) })
    .first();
}

/** A selector of the layer panel, found by the label above it. */
function selector(page: Page, label: string): Locator {
  return page
    .locator('label.side-panel-panel__label', { hasText: new RegExp(`^${label}$`) })
    .first()
    .locator('xpath=following::div[contains(@class,"item-selector__dropdown")][1]');
}

test(
  'draws a symbol per station, turned by the direction column',
  async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
    test.slow();
    const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

    const map = panelEditPage.panel.locator.locator('canvas').first();
    await expect(map).toBeVisible({ timeout: 60_000 });
    await settle(page);

    await expect
      .poll(async () => (await readKepler(map)).layers.map((l) => l.type), { timeout: 60_000 })
      // The Point layer kepler guesses from the same coordinates is removed:
      // without this, the user sees plain dots underneath the symbols.
      .toEqual(['symbol']);

    // One per station, and the layer is born already drawing: before this, a
    // scattered station query built a flow field that drew nothing.
    await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);

    const drawn = (await readSymbolLayer(map))!;
    expect(drawn.channels.angleField).toBe('wind_direction');
    expect(drawn.channels.sizeField).toBe('wind_speed');

    // A meteorological direction says where the wind comes from, so the arrow
    // points the other way: 90° in the column is a deck angle of -270.
    expect(drawn.angles[0]).toBeCloseTo(-270, 5);
    // Eight different bearings, eight different angles: nothing collapsed.
    expect(new Set(drawn.angles.map((a) => Math.round(a))).size).toBe(8);
  }
);

test('shows the station under the pointer', async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);

  // The tooltip is what a row-based layer buys: the vector field cannot have
  // one, because its symbols are samples of a grid and no row of anything.
  //
  // The eight stations are scattered across Ecuador on purpose (that is the
  // fork this whole feature turns on -- see the fixture), which also means
  // hovering the map's bounding-box centre is not reliable: no station sits
  // anywhere near the centroid or the midpoint of the bounding box of eight
  // points spread across the whole country. `projectRows` (already used by
  // `clickEntity.spec.ts` to click an exact row) gives the real screen
  // position of a station instead of guessing one.
  const rows = await projectRows(map);
  expect(rows.length).toBeGreaterThan(0);
  const target = rows[0];
  await page.mouse.move(target.x, target.y);
  await page.mouse.move(target.x + 2, target.y + 2);
  await expect(page.locator('.map-popover').first()).toBeVisible({ timeout: 30_000 });
});

test('turns the symbols by whichever column the rotation is bound to', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);
  const before = (await readSymbolLayer(map))!;
  expect(before.angleTriggerField).toBe('wind_direction');

  // The rotation group's first selector is the channel's column picker.
  await openLayerPanel(page);
  await click(group(page, 'Rotation').locator('.item-selector__dropdown').first());
  await click(page.locator('.list__item', { hasText: 'wind_speed' }).first());

  await expect
    .poll(async () => (await readSymbolLayer(map))?.channels.angleField, { timeout: 30_000 })
    .toBe('wind_speed');
  const after = (await readSymbolLayer(map))!;
  // deck redraws an attribute when its trigger changes, never because the
  // accessor is a new function — so the trigger has to name the new column.
  expect(after.angleTriggerField).toBe('wind_speed');
  // Cuenca again: 3.1 in the new column, still read as where the wind comes
  // from, so half a turn on — against -270 from its 90° direction.
  expect(after.angles[0]).toBeCloseTo(-183.1, 5);
  expect(after.angles).not.toEqual(before.angles);
});

test('paints the chosen shape into the atlas and draws with it', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);
  // The atlas carries the glyph in use and nothing else.
  expect((await readSymbolLayer(map))!.atlasKeys).toEqual(['arrow']);

  // The arrow is one of the shapes, so the picker opens there; the airport is
  // under Transport. Each option reads as the glyph's own name, matched whole,
  // because the search keeps other names that merely contain the letters.
  await openLayerPanel(page);
  await expect(selector(page, 'Category')).toContainText('Shapes');
  await click(selector(page, 'Category'));
  await click(page.locator('.list__item', { hasText: /^Transport$/ }).first());
  await click(selector(page, 'Shape'));
  await page.locator('.typeahead__input').first().fill('airport');
  await click(page.locator('.list__item', { hasText: /^airport$/ }).first());

  await expect.poll(async () => (await readSymbolLayer(map))?.symbol, { timeout: 30_000 }).toBe('airport');
  const after = (await readSymbolLayer(map))!;
  expect(after.atlasKeys).toEqual(['airport']);
  // And deck asks for it by the same name the atlas holds it under.
  expect(after.iconKeys).toEqual(['airport']);
});

test('offers the hazards, and draws OCHA’s flood from the list', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);

  await openLayerPanel(page);
  await click(selector(page, 'Category'));
  await click(page.locator('.list__item', { hasText: /^Hazards$/ }).first());
  // A category narrows the list; it does not change what is drawn.
  expect((await readSymbolLayer(map))!.symbol).toBe('arrow');

  await click(selector(page, 'Shape'));
  await page.locator('.typeahead__input').first().fill('flood');
  await click(page.locator('.list__item', { hasText: /^ocha:flood$/ }).first());

  await expect.poll(async () => (await readSymbolLayer(map))?.symbol, { timeout: 30_000 }).toBe('ocha:flood');
  const after = (await readSymbolLayer(map))!;
  expect(after.atlasKeys).toEqual(['ocha:flood']);
  expect(after.iconKeys).toEqual(['ocha:flood']);
  await expect(selector(page, 'Category')).toContainText('Hazards');

  // The chosen value is drawn beside its name by the atlas's own painter.
  const preview = selector(page, 'Shape').locator('canvas[data-symbol="ocha:flood"]');
  await expect(preview).toBeVisible();
  const inked = await preview.evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        count++;
      }
    }
    return count;
  });
  expect(inked).toBeGreaterThan(20);
});

for (const [id, name] of [
  ['6', 'temaki:power_tower'],
  ['7', 'ocha:flood'],
] as const) {
  test(`draws the saved panel ${id} with ${name}`, async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
    test.slow();
    const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id });

    const map = panelEditPage.panel.locator.locator('canvas').first();
    await expect(map).toBeVisible({ timeout: 60_000 });
    await settle(page);

    await expect
      .poll(async () => (await readKepler(map)).layers.map((l) => l.type), { timeout: 60_000 })
      .toEqual(['symbol']);
    await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);
    const drawn = (await readSymbolLayer(map))!;
    expect(drawn.atlasKeys).toEqual([name]);
    expect(drawn.iconKeys).toEqual([name]);
  });
}

test('leaves one symbol per station under the dashboard clock', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  // The second panel: the same eight stations reporting at 07:00 and 08:00,
  // with the dashboard window on the first hour and the time sync pushing it
  // onto the map. `symbolLayer.clock.test.ts` runs the same fixture through
  // kepler's store in jest; this is the browser's word on it.
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect
    .poll(async () => (await readKepler(map)).layers.map((l) => l.type), { timeout: 60_000 })
    .toEqual(['symbol']);
  await expect
    .poll(async () => (await readKepler(map)).filters.map((f) => f.type), { timeout: 60_000 })
    .toEqual(['timeRange']);

  // Both hours reach the layer — the rows are kept on purpose, and the clock's
  // filter runs on the GPU rather than removing any of them...
  await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(16);
  // ...and it lets one hour through: a symbol per station, not two stacked.
  await expect.poll(async () => (await readSymbolLayer(map))?.shown, { timeout: 30_000 }).toBe(8);
});

test('restores the styled panel with its shadow, outline, gradient and labels', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  // The third panel carries a saved map config, so no layer is added for it:
  // everything drawn comes from what was saved. `symbolLayer.saved.test.ts`
  // restores the same config through kepler's merger in jest.
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '3' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect
    .poll(async () => (await readKepler(map)).layers.map((l) => l.type), { timeout: 60_000 })
    .toEqual(['symbol']);
  await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);

  const drawn = (await readSymbolLayer(map))!;
  // Drawn bottom to top: the shadow, the outline, the symbols, their labels.
  expect(drawn.deckLayerIds).toEqual([
    'styled-stations-symbol-shadow',
    'styled-stations-symbol-outline',
    'styled-stations-symbol',
    'styled-stations-label-name',
  ]);
  // The gradient rides after kepler's own filter extension, never instead of it.
  expect(drawn.extensions).toEqual(['DataFilterExtension', 'SymbolGradientExtension']);
  expect(drawn.gradientTail).toBe(0.75);
  expect(drawn.billboard).toBe(false);
});

test('stands the symbols up in the 3D panel', async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '4' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);

  const drawn = (await readSymbolLayer(map))!;
  expect(drawn.billboard).toBe(true);
  expect(drawn.iconKeys).toEqual(['marker']);
  // No bearing column: a standing marker is not turned.
  expect(new Set(drawn.angles)).toEqual(new Set([0]));
});

test('draws a picture per station, and names the one that cannot load', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  // Installed before Grafana loads, so no violation can happen unheard.
  await page.addInitScript(() => {
    const scope = window as unknown as { __cspViolations: string[] };
    scope.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      scope.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '5' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);

  // Four different pictures: the layer's own data URI, two of the plugin's
  // files, and one from an origin that does not allow cross-origin use.
  await expect.poll(async () => (await readPictureDeck(map))?.keys.length ?? 0, { timeout: 60_000 }).toBe(4);
  await expect.poll(async () => (await readPictureDeck(map))?.loaded ?? false, { timeout: 60_000 }).toBe(true);

  await openLayerPanel(page);
  // `.first()`: the notice and the line inside it both contain the text.
  await expect(page.getByText('1 of 4 pictures could not load').first()).toBeVisible({ timeout: 30_000 });
  // Named by its URL: `127.0.0.1` is another origin than `localhost`, and
  // Grafana serves its files with no Access-Control-Allow-Origin.
  await expect(page.getByText(/127\.0\.0\.1:3000.* — Could not load/).first()).toBeVisible();
  // And the three that loaded are not named at all.
  await expect(page.getByText(/^\/public\/plugins.* — /)).toHaveCount(0);
  await expect(page.getByText(/^data:image.* — /)).toHaveCount(0);

  // Under a strict CSP, the proof that pictures travel by `img-src` alone.
  const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
  expect(
    violations.filter((line) => /data:|blob:|\/public\/plugins\/ubica-keplergl-panel\/img\//.test(line))
  ).toEqual([]);
});
