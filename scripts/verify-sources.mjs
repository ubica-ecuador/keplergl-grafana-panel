/**
 * Smoke check for the sources bench (:3002).
 *
 * The bench exists to answer one question — does each file format still reach a
 * rendered map? — and a passing /api/ds/query proves only that rows arrived, not
 * that kepler drew them. So this drives a real browser and reports, per panel,
 * whether a map surface and a layer exist.
 *
 *   npm run server:sources     # bring the bench up first
 *   npm run verify:sources
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3002';
const OUT = process.argv[3] ?? 'sources-verify.png';
const DASHBOARD = process.argv[4] ?? '/d/sources-bench/fuentes-geoparquet-geojson-y-csv?kiosk';

// Grafana's bundled apps log these on every page load, unrelated to the plugin.
const IGNORED_CONSOLE = [/livereload\.js/, /metricsdrilldown/, /lokiexplore/, /Could not register link extension/];

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
// Tall viewport: the panels are stacked, and a map that never enters the
// viewport never initialises its WebGL context, which would read as a failure.
const page = await browser.newPage({ viewport: { width: 1600, height: 2400 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(m.text()))) {
    consoleErrors.push(m.text());
  }
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
// kepler's empty-state modal contains a file input; never let it block the run.
page.on('filechooser', (fc) => fc.setFiles([]).catch(() => {}));

await page.goto(BASE + DASHBOARD, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 90_000 });
// Five WebGL contexts on software rendering are slow to settle.
await page.waitForTimeout(20_000);

const state = await page.evaluate(() => {
  const headers = Array.from(document.querySelectorAll('[data-testid^="data-testid Panel header"]'));
  return {
    totalCanvases: document.querySelectorAll('canvas').length,
    // Only shown when kepler holds no dataset at all — the clearest failure signal.
    emptyStates: document.body.innerText.split('Drag & Drop Your File(s) Here').length - 1,
    panels: headers.map((header) => {
      const root = header.closest('section, [data-viz-panel-key]') ?? header.parentElement;
      return {
        title: header.getAttribute('data-testid').replace('data-testid Panel header ', ''),
        canvases: root?.querySelectorAll('canvas').length ?? 0,
        layers: Array.from(root?.querySelectorAll('[class*="layer-panel"] input') ?? []).map((i) => i.value),
        // kepler's bottom time widget: present only once a time filter exists,
        // which is what makes a map spatio-temporal rather than just spatial.
        timeWidget: !!root?.querySelector('[class*="time-widget"], [class*="animation-control"]'),
      };
    }),
  };
});

await page.screenshot({ path: OUT, fullPage: true });

const maps = state.panels.filter((p) => p.canvases > 0);
console.log(JSON.stringify({ target: BASE, ...state, consoleErrors }, null, 2));
console.log(`\n${maps.length} panel(s) with a map surface, ${state.emptyStates} empty state(s). Screenshot: ${OUT}`);

await browser.close();
