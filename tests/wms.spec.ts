import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { settle } from './keplerHelpers';

/**
 * A WMS layer asks the service for a date, and the map's clock chooses it.
 *
 * kepler draws a WMS but has no notion of its time dimension: the request it
 * builds carries no `TIME`, so a time-aware service answers with its default
 * slice for ever. What is pinned here is the whole chain that fixes that — the
 * service's own calendar becomes the map's time domain, and the date it selects
 * reaches the `GetMap` as a parameter.
 *
 * The service is stubbed, so the suite still makes no outbound call. The
 * provisioned dashboard points at the real GeoGLOWS endpoint because a demo
 * has to; every request it makes is intercepted here.
 */

test.use({ viewport: { width: 1600, height: 1000 } });

// Loading kepler, reading a capabilities document and drawing a tile does not
// fit in playwright's default half minute.
test.describe.configure({ timeout: 120_000 });

const SERVICE = 'https://services.geoglows.org/geoserver/satellite_based_precipitation/wms';
const LAYER = 'persiann_pdir_24h';
const DATES = ['2026-08-23T00:00:00.000Z', '2026-08-24T00:00:00.000Z', '2026-08-25T00:00:00.000Z'];

/** A 1×1 transparent PNG — the loader parses the body, so it has to be a real image. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * What GeoServer answers a `GetFeatureInfo` with, in GML.
 *
 * GML rather than plain text on purpose: kepler parses the reply by walking
 * `gml:featureMember`, so a service answering in prose — which is what
 * loaders.gl asks for unless told otherwise — leaves the click with nothing.
 */
const FEATURE_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:sbp="http://stub">
  <gml:featureMember>
    <sbp:${LAYER} fid=""><sbp:GRAY_INDEX>12.5</sbp:GRAY_INDEX></sbp:${LAYER}>
  </gml:featureMember>
</wfs:FeatureCollection>`;

/** A capabilities document as GeoServer writes one, cut down to what is read. */
function capabilities(extent: string | null): string {
  const dimension = extent
    ? `<Dimension name="time" units="ISO8601" default="${DATES[DATES.length - 1]}">${extent}</Dimension>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>Stub</Title></Service>
  <Capability>
    <Layer>
      <Title>Stub root</Title>
      <CRS>EPSG:4326</CRS>
      <Layer queryable="1">
        <Name>${LAYER}</Name>
        <Title>${LAYER}</Title>
        <EX_GeographicBoundingBox>
          <westBoundLongitude>-92</westBoundLongitude>
          <eastBoundLongitude>-75</eastBoundLongitude>
          <southBoundLatitude>-5</southBoundLatitude>
          <northBoundLatitude>2</northBoundLatitude>
        </EX_GeographicBoundingBox>
        ${dimension}
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;
}

/** Every GetMap the page asked for, in order, with the parameters that matter. */
interface Requested {
  time: string | null;
  layers: string | null;
}

/**
 * Serves the WMS from the test, and records what was asked of it.
 *
 * One handler for both requests, because a WMS is one endpoint: which request
 * it is lives in a parameter, and reading it here is exactly what the real
 * server does.
 */
async function stubService(page: Page, extent: string | null): Promise<Requested[]> {
  return (await stubbedService(page, extent)).asked;
}

/** The same stub, with the feature-info side of it visible to the caller. */
async function stubbedService(
  page: Page,
  extent: string | null
): Promise<{ asked: Requested[]; queried: Requested[] }> {
  const asked: Requested[] = [];
  const queried: Requested[] = [];

  // A regexp rather than a glob: playwright's `*` does not cross a `/`, and
  // every GetMap carries `FORMAT=image/png`.
  await page.route(/services\.geoglows\.org\/geoserver\/.*\/wms/, (route) => {
    const url = new URL(route.request().url());
    // WMS parameter names are case-insensitive and the two callers here
    // disagree about case, so the lookup has to be too.
    const param = (name: string) => {
      for (const [key, value] of url.searchParams) {
        if (key.toLowerCase() === name) {
          return value;
        }
      }
      return null;
    };

    const request = (param('request') ?? '').toLowerCase();
    if (request === 'getcapabilities') {
      return route.fulfill({ status: 200, contentType: 'text/xml', body: capabilities(extent) });
    }
    if (request === 'getfeatureinfo') {
      queried.push({ time: param('time'), layers: param('query_layers') });
      return route.fulfill({ status: 200, contentType: 'text/xml', body: FEATURE_INFO });
    }
    asked.push({ time: param('time'), layers: param('layers') });
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });

  return { asked, queried };
}

/**
 * Waits until the service has been left alone for a moment.
 *
 * Counting requests is only meaningful once the first load has finished asking,
 * and "finished" is not an event anyone emits: the image arrives after the
 * capabilities, which arrives after the query. Two quiet seconds is the
 * cheapest honest definition, and without it the count below sometimes catches
 * the tail of the load and reads it as a refresh.
 */
async function quiet(page: Page, asked: Requested[]): Promise<number> {
  let seen = -1;
  while (seen !== asked.length) {
    seen = asked.length;
    await page.waitForTimeout(2000);
  }
  return asked.length;
}

test('asks the service for the newest date its own calendar publishes', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubService(page, DATES.join(','));

  const dashboard = await readProvisionedDashboard({ fileName: 'wms.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  // The query names a service and a layer and no date at all. Everything about
  // the date below came from the service's own capabilities document.
  expect(asked[asked.length - 1]).toEqual({ time: DATES[DATES.length - 1], layers: LAYER });
});

test('asks for nothing new when the dashboard refreshes', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubService(page, DATES.join(','));

  const dashboard = await readProvisionedDashboard({ fileName: 'wms.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);
  const afterLoad = await quiet(page, asked);

  // A refresh re-runs the query and hands the panel a new object describing the
  // very same layer. Left unguarded that rebuilds the dataset, and the map
  // blinks every thirty seconds on a dashboard that auto-refreshes.
  await page.getByRole('button', { name: /Refresh/i }).first().click();
  await settle(page);

  expect(await quiet(page, asked)).toBe(afterLoad);
});

test('draws a service with no time dimension, asking it for no date', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubService(page, null);

  const dashboard = await readProvisionedDashboard({ fileName: 'wms.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  // No calendar anywhere — neither the query nor the service has one — so there
  // is no timeline to build and the layer behaves as it does upstream. Silence
  // rather than a guessed date: a date the service does not have would come
  // back as an empty tile and read as a broken map.
  expect(asked[asked.length - 1]).toEqual({ time: null, layers: LAYER });
});

test('asks the service what is under a clicked pixel, on the date being shown', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const { asked, queried } = await stubbedService(page, DATES.join(','));

  const dashboard = await readProvisionedDashboard({ fileName: 'wms.json' });
  await gotoDashboardPage(dashboard);
  const map = page.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await quiet(page, asked);

  const box = await map.boundingBox();
  if (!box) {
    throw new Error('map has no bounding box');
  }
  // Well away from the bottom centre: kepler's time widget sits there and
  // swallows the click, which reads exactly like a layer that cannot be picked.
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35, { delay: 100 });

  await expect.poll(() => queried.length, { timeout: 30_000 }).toBeGreaterThan(0);

  // The date matters as much as the value. `GetFeatureInfo` does not carry the
  // time parameter of its own accord — loaders.gl leaves it out of that request
  // — so without it the service would answer for its default date and hand back
  // a number from another day, which looks perfectly reasonable.
  expect(queried[queried.length - 1]).toEqual({ time: DATES[DATES.length - 1], layers: LAYER });

  // And it reaches the dashboard, which is the point of asking.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('var-valor'), { timeout: 30_000 })
    .toBe('12.5');
});
