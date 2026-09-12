import { test, expect, PanelEditPage } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { readFlowField, readKepler, settle, StreamlineSample } from './keplerHelpers';

/** The flow field is slow under software rendering — see `flowfield.spec.ts`. */
test.describe.configure({ timeout: 180_000 });

const meanEastward = (sample: StreamlineSample[]) =>
  sample.reduce((sum, line) => sum + line.eastward, 0) / (sample.length || 1);

/**
 * A scalar column must become a flow, running the way the ground falls.
 *
 * The provisioned dashboard feeds terrain heights and nothing else: there is no
 * velocity anywhere in either query, and `u` and `v` are computed from the
 * slope, which is the whole of what this mode does.
 *
 * Asserted as geometry rather than as a picture, for the reason the sibling
 * spec gives: at the start of the animation window every trail has zero length,
 * so a paused field draws nothing at all.
 */

/** The panel's map, once it holds a flow field that has traced something. */
async function tracedMap(panelEditPage: PanelEditPage, page: Page) {
  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect
    .poll(async () => (await readKepler(map)).layers.map((l: { type: string }) => l.type), { timeout: 60_000 })
    .toEqual(['flowfield']);
  await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(50);
  return map;
}

test('runs downhill, on ground that only ever rises east', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'flowfieldGradient.json' });
  // The constant slope: a plane rising 500 m per degree east, and so a field
  // with one answer everywhere, which is what makes the sign the whole test.
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '3' });

  const map = await tracedMap(panelEditPage, page);
  const field = await readFlowField(map);

  expect(field?.visConfig.gradientDirection).toBe('downhill');
  // Read as a `u` component the same numbers would run east. The sign is the
  // whole assertion.
  expect(meanEastward(field!.sample)).toBeLessThan(0);
});

test('converges on the valley floor from both sides of it', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'flowfieldGradient.json' });
  // A V-shaped valley whose floor runs north to south along 79°W.
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = await tracedMap(panelEditPage, page);
  const field = await readFlowField(map);

  const west = field!.sample.filter((line) => line.lng < -79.1);
  const east = field!.sample.filter((line) => line.lng > -78.9);
  expect(west.length).toBeGreaterThan(10);
  expect(east.length).toBeGreaterThan(10);

  // The picture no uniform field can draw: the two sides run *towards each
  // other*. A mean over all of them would be near zero and say nothing.
  expect(meanEastward(west)).toBeGreaterThan(0);
  expect(meanEastward(east)).toBeLessThan(0);
});
