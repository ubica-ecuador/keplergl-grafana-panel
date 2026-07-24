/**
 * Phase 0 spike verification.
 *
 * Drives a real browser against the provisioned dashboard and checks the five
 * exit criteria from the plan. Run against both dev containers:
 *
 *   node scripts/verify-spike.mjs http://localhost:3000   # default CSP
 *   node scripts/verify-spike.mjs http://localhost:3001   # strict CSP
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

// Criterion 1: kepler mounts and renders its WebGL canvas.
await page.waitForSelector('canvas', { timeout: 60_000 });
await page.waitForTimeout(8000);

const probe = async () =>
  page.evaluate(() => {
    const text = document.body.innerText;
    return {
      canvases: document.querySelectorAll('canvas').length,
      // kepler renders one .layer-panel per layer in the side panel.
      layerPanels: document.querySelectorAll('[class*="layer-panel"]').length,
      hasSpikeDataset: text.includes('Spike data'),
      // The empty-state modal only appears when kepler has no datasets at all.
      showsAddDataModal: text.includes('Drag & Drop Your File(s) Here'),
      styleTagsInPanel: document.querySelectorAll('[class*="panel-content"] style, [data-panelid] style').length,
      styleTagsInHead: document.head.querySelectorAll('style').length,
    };
  });

const before = await probe();

// Criterion 4: a hand-configured layer must survive a data refresh.
// Rename the auto-created layer, then trigger the updateVisData path.
let renamed = false;
const layerName = page.locator('[class*="layer-panel"] input').first();
if (await layerName.count()) {
  await layerName.fill('KEEP-ME');
  await layerName.press('Enter');
  renamed = true;
}
await page.waitForTimeout(1000);

await page.getByTestId('spike-refresh').click();
await page.waitForTimeout(4000);
await page.getByTestId('spike-refresh').click();
await page.waitForTimeout(4000);

const after = await probe();
// The layer name lives in an <input value>, not in text content — read the value.
const layerSurvived = renamed
  ? await page.evaluate(() =>
      Array.from(document.querySelectorAll('[class*="layer-panel"] input')).some((i) => i.value === 'KEEP-ME')
    )
  : null;

// The Flow layer is the whole reason this plugin pins a kepler.gl pre-release
// (it does not exist in 3.2.6). Prove it reached the bundle by opening the
// layer type picker and reading the offered types.
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
const hasFlowLayer = layerTypes.some((t) => /^flow$/i.test(t ?? ''));

await page.screenshot({ path: OUT });

// Criterion 5: kepler's styled-components rules stay inside the panel.
const grafanaUiIntact = await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="spike-refresh"]');
  if (!btn) {
    return null;
  }
  return getComputedStyle(btn).fontFamily;
});

console.log(
  JSON.stringify(
    {
      target: BASE,
      before,
      after,
      renamed,
      layerSurvived,
      hasFlowLayer,
      layerTypes: [...new Set(layerTypes)],
      grafanaUiFontFamily: grafanaUiIntact,
      cspViolations,
      consoleErrors,
    },
    null,
    2
  )
);

await browser.close();
