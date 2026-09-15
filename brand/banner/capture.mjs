// Captures one kepler panel with a forced viewport, for the banner's map slices.
// Read-only: the dashboard JSON is rewritten in flight, nothing is saved.
//
//   node capture.mjs <base> <uid> <panelId> <out.png> <lat> <lng> <zoom> [user:pass] [waitMs]
//
// HEADED=1 renders on the real GPU. Software WebGL never settles a frame while a
// flow field is animating, so a headless screenshot of one hangs.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../package.json'));
const { chromium } = require('@playwright/test');

const [base, uid, panelId, out, lat, lng, zoom, auth, waitMs = '20000'] = process.argv.slice(2);
const mapState = {
  latitude: Number(lat),
  longitude: Number(lng),
  zoom: Number(zoom),
  pitch: 0,
  bearing: 0,
  dragRotate: false,
};

function rewrite(node) {
  if (Array.isArray(node)) {
    node.forEach(rewrite);
    return;
  }
  if (node && typeof node === 'object') {
    if (node.mapState && typeof node.mapState === 'object') {
      Object.assign(node.mapState, mapState);
    }
    if ('mapConfig' in node && 'showSidePanel' in node) {
      node.showSidePanel = false;
    }
    Object.values(node).forEach(rewrite);
  }
}

const browser = await chromium.launch(
  process.env.HEADED
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
);
const context = await browser.newContext({
  viewport: { width: 1100, height: 1100 },
  deviceScaleFactor: 2,
  ...(auth ? { httpCredentials: { username: auth.split(':')[0], password: auth.split(':')[1] } } : {}),
});
const page = await context.newPage();

// Grafana 13 loads the dashboard from /apis/dashboard.grafana.app/.../<uid>/dto, so
// match on the uid anywhere in the path, not as the last segment.
const isDashboardUrl = (url) =>
  url.pathname.includes(`/${uid}`) && !/annotations|rules|public-dashboards/.test(url.pathname + url.search);

await page.route(isDashboardUrl, async (route) => {
  const req = route.request();
  if (req.resourceType() !== 'fetch' && req.resourceType() !== 'xhr') {
    return route.continue();
  }
  const res = await route.fetch();
  const type = res.headers()['content-type'] || '';
  if (!type.includes('json')) {
    return route.fulfill({ response: res });
  }
  const body = await res.json();
  rewrite(body);
  console.log('rewrote', req.url());
  return route.fulfill({ response: res, json: body });
});

await page.goto(`${base}/d/${uid}?viewPanel=panel-${panelId}&kiosk`, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForSelector('canvas', { timeout: 60000 });
} catch (err) {
  await page.screenshot({ path: out.replace('.png', '-timeout.png') });
  console.log('no canvas; url', page.url());
  await browser.close();
  throw err;
}
await page.waitForTimeout(Number(waitMs));

// Map chrome off: kepler's control column, attribution, time widget.
await page.addStyleTag({
  content: `
    .map-control, [class*="map-control"], .attrition-link, .attrition-logo,
    .maplibregl-ctrl, .mapboxgl-ctrl, .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right,
    .bottom-widget--container, [class*="bottom-widget"], .map-popover, [class*="side-panel__"],
    [class*="MapControl"], .kepler-gl__map-legend { display: none !important; }
  `,
});
await page.waitForTimeout(800);
await page.screenshot({ path: out, timeout: 180000, animations: 'disabled' });
console.log('saved', out);
await browser.close();
