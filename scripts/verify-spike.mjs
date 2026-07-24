/**
 * Smoke check against the provisioned dashboard.
 *
 * Drives a real browser and reports what actually reached the map, so a
 * regression shows up as data rather than as a screenshot someone has to squint
 * at. Run against both dev containers:
 *
 *   npm run verify:spike       # default CSP   (localhost:3000)
 *   npm run verify:spike:csp   # strict CSP    (localhost:3001)
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const DASHBOARD = '/d/a538aeff-5a8a-42a5-901c-938d896fdd6f/kepler-gl-spike?kiosk';
const OUT = process.argv[3] ?? 'spike-verify.png';

// Grafana's bundled apps log these on every page load, unrelated to the plugin.
const IGNORED_CONSOLE = [/livereload\.js/, /metricsdrilldown/, /lokiexplore/, /Could not register link extension/];

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const consoleErrors = [];
const cspViolations = [];
page.on('console', (m) => {
  if (m.type() !== 'error') {
    return;
  }
  const text = m.text();
  if (IGNORED_CONSOLE.some((re) => re.test(text))) {
    return;
  }
  consoleErrors.push(text);
  if (/Content Security Policy|worker-src|blob:/i.test(text)) {
    cspViolations.push(text);
  }
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
// kepler's empty-state modal contains a file input; never let it block the run.
page.on('filechooser', (fc) => fc.setFiles([]).catch(() => {}));

await page.goto(BASE + DASHBOARD, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 60_000 });
await page.waitForTimeout(8000);

const probe = async () =>
  page.evaluate(() => {
    const text = document.body.innerText;
    return {
      canvases: document.querySelectorAll('canvas').length,
      datasetNames: Array.from(document.querySelectorAll('.dataset-name')).map((e) => e.textContent?.trim()),
      rowCounts: Array.from(document.querySelectorAll('[class*="source-data-rows"]')).map((e) =>
        e.textContent?.trim()
      ),
      layerNames: Array.from(document.querySelectorAll('[class*="layer-panel"] input')).map((i) => i.value),
      // The empty-state modal only appears when kepler has no datasets at all.
      showsAddDataModal: text.includes('Drag & Drop Your File(s) Here'),
      styleTagsInPanel: document.querySelectorAll('[class*="panel-content"] style, [data-panelid] style').length,
      styleTagsInHead: document.head.querySelectorAll('style').length,
    };
  });

const state = await probe();

// The Flow layer is why this plugin pins a kepler.gl pre-release (it does not
// exist in 3.2.6). Prove it reached the bundle by reading the type picker.
let layerTypes = [];
try {
  await page.getByText('Add Layer', { exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  await page.getByText('Select A Type', { exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  layerTypes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.layer-type-selector__item__label')).map((e) => e.textContent?.trim())
  );
} catch {
  layerTypes = ['<could not open layer type picker>'];
}

await page.screenshot({ path: OUT });

// kepler's styled-components rules must stay inside the panel.
const grafanaUiFontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);

console.log(
  JSON.stringify(
    {
      target: BASE,
      ...state,
      hasFlowLayer: layerTypes.some((t) => /^flow$/i.test(t ?? '')),
      layerTypeCount: layerTypes.length,
      grafanaUiFontFamily,
      cspViolations,
      consoleErrors,
    },
    null,
    2
  )
);

await browser.close();
