/**
 * Captures the screenshots the documentation site uses.
 *
 * Built on the same footing as `verify-sources.mjs` — software GL, a guard
 * against kepler's empty-state file input, and long settles — because the same
 * things go wrong. What differs is the output: this writes image files rather
 * than a report.
 *
 * Images are committed to the repository rather than generated in CI. Building
 * them needs Docker, a running Grafana and outbound access to every base map
 * and dataset, none of which belongs in a docs build.
 *
 *   npm run server           # :3000, the provisioned dashboards
 *   npm run server:sources   # :3002, the bench with DuckDB and Infinity
 *   npm run docs:shots       # all of them
 *   npm run docs:shots -- point trip   # just the ones whose name matches
 *
 * One panel is captured at a time, through Grafana's single-panel view. That is
 * not a stylistic choice: each map holds two WebGL contexts against a browser
 * cap near sixteen, and capturing a whole dashboard of maps would black out the
 * oldest ones. The single-panel view also works for a panel inside a collapsed
 * row, which is how the layer gallery is laid out.
 */
import { chromium } from 'playwright';
import { mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const MAIN = process.env.DOCS_SHOTS_MAIN ?? 'http://localhost:3000';
const SOURCES = process.env.DOCS_SHOTS_SOURCES ?? 'http://localhost:3002';
const OUT_DIR = 'docs/site/public/img';

/** Weight budget per image. Forty PNGs of a satellite map would be ~35 MB. */
const MAX_BYTES = 200 * 1024;

/**
 * What to capture.
 *
 * `panel` is Grafana 12's Scenes-era identifier — `panel-<id>`, not a bare id.
 *
 * `wait` is on top of waiting for a canvas to exist: a canvas appears long
 * before the tiles and the deck.gl layers have settled, and under software
 * rendering that gap is seconds, not frames.
 *
 * `animate` is for Trip layers, which draw nothing at all until the clock has
 * run: at the start of the window every trail is zero-length, so a naive
 * capture of a trajectory map is an empty map. Playing for a few seconds and
 * then shooting is the only way to photograph an animation.
 *
 * `hideSidePanel` and `hideBottomWidget` default to hiding, because kepler
 * overlays both on top of the map and a documentation image wants the map.
 * Set either to `false` where the chrome *is* the subject.
 *
 * Not yet covered here: a **velocity field** panel. Its subtree re-traces on
 * every settle and never goes quiet, so Playwright's auto-waiting — which
 * `locator.screenshot()` and `boundingBox()` both do — times out, and under
 * software rendering a field of thousands of animating streamlines does not
 * yield a frame inside the default screenshot timeout either. Capturing one
 * means reading the rect with `page.evaluate`, clipping a page screenshot to
 * it, and pausing the animation first.
 */
const SHOTS = [
  // ---- Layer gallery. One map per layer type the panel can build from rows.
  ...[
    ['point', 'panel-2'],
    ['heatmap', 'panel-4'],
    ['grid', 'panel-6'],
    ['hexagon', 'panel-8'],
    ['cluster', 'panel-10'],
    ['icon', 'panel-12'],
    ['geojson', 'panel-14'],
    ['h3', 'panel-16'],
    ['s2', 'panel-18'],
    ['arc', 'panel-20'],
    ['line', 'panel-22'],
    ['flow', 'panel-24'],
  ].map(([name, panel]) => ({
    name: `layer-${name}`,
    base: MAIN,
    dashboard: '/d/e1f2a3b4-0000-4000-8000-000000000006/kepler-gl-layer-gallery',
    panel,
    wait: 9000,
  })),
  {
    name: 'layer-trip',
    base: MAIN,
    dashboard: '/d/e1f2a3b4-0000-4000-8000-000000000006/kepler-gl-layer-gallery',
    panel: 'panel-26',
    wait: 9000,
    animate: 6000,
  },

  // ---- Guide illustrations, from the other provisioned dashboards.
  {
    name: 'guide-trips',
    base: MAIN,
    dashboard: '/d/a538aeff-5a8a-42a5-901c-938d896fdd6f/kepler-gl-spike',
    panel: 'panel-1',
    wait: 10000,
    animate: 6000,
  },
  {
    name: 'guide-geometry-ewkb',
    base: MAIN,
    dashboard: '/d/a538aeff-5a8a-42a5-901c-938d896fdd6f/kepler-gl-spike',
    panel: 'panel-2',
    wait: 9000,
  },
  {
    name: 'guide-flows',
    base: MAIN,
    dashboard: '/d/c1d2e3f4-0000-4000-8000-000000000002/kepler-gl-flows',
    panel: 'panel-1',
    wait: 10000,
  },
  {
    name: 'guide-cross-filter',
    base: MAIN,
    dashboard: '/d/d1e2f3a4-0000-4000-8000-000000000003/kepler-gl-cross-filter',
    panel: 'panel-1',
    // The side panel is the subject here: cross-filtering is driven from
    // kepler's filter list, and a shot without it shows nothing of the point.
    hideSidePanel: false,
    hideBottomWidget: false,
    wait: 10000,
  },

  // ---- The sources bench, for the data source recipes.
  {
    name: 'source-geoparquet-points',
    base: SOURCES,
    dashboard: '/d/sources-bench/fuentes-geoparquet-geojson-y-csv',
    panel: 'panel-2',
    wait: 12000,
  },
  {
    name: 'source-geoparquet-zones',
    base: SOURCES,
    dashboard: '/d/sources-bench/fuentes-geoparquet-geojson-y-csv',
    panel: 'panel-3',
    wait: 12000,
  },
  {
    name: 'source-geojson-url',
    base: SOURCES,
    dashboard: '/d/sources-bench/fuentes-geoparquet-geojson-y-csv',
    panel: 'panel-4',
    wait: 12000,
  },
  {
    name: 'source-earthquakes',
    base: SOURCES,
    dashboard: '/d/earthquakes/terremotos-espacio-temporal',
    panel: 'panel-1',
    wait: 15000,
  },
];

/**
 * Console noise that is not the plugin's.
 *
 * Matched against the message *and* the resource URL, because the interesting
 * ones say only "Failed to load resource: net::ERR_CONNECTION_REFUSED" and put
 * the offender — usually the livereload script, which is not running unless
 * `npm run dev` is — in the location instead.
 */
const IGNORED_CONSOLE = [
  /livereload/,
  /:35729/,
  /metricsdrilldown/,
  /lokiexplore/,
  /Could not register link extension/,
  /favicon\.ico/,
];

const PANEL_SELECTOR = 'section[data-testid^="data-testid Panel header"]';
const SIDE_PANEL = '.side-panel--container';
const BOTTOM_WIDGET = '.bottom-widget--container';
/** The trip animation's own controls; its first button is play. */
const PLAY_BUTTON = '.animation-control-container .playback-control-button';

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const selected = filters.length ? SHOTS.filter((s) => filters.some((f) => s.name.includes(f))) : SHOTS;

if (!selected.length) {
  console.error(`No shot matches ${filters.join(', ')}. Known: ${SHOTS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
  viewport: { width: 1000, height: 640 },
  // Device pixels double the file size for a screenshot nobody zooms into.
  deviceScaleFactor: 1,
  colorScheme: 'dark',
});
// kepler's empty state contains a file input; never let it block the run.
context.on('page', (page) => page.on('filechooser', (fc) => fc.setFiles([]).catch(() => {})));

const page = await context.newPage();
const results = [];

for (const shot of selected) {
  const errors = [];
  const onConsole = (m) => {
    const where = `${m.text()} ${m.location()?.url ?? ''}`;
    if (m.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(where))) {
      errors.push(m.text());
    }
  };
  page.on('console', onConsole);

  const url = `${shot.base}${shot.dashboard}?viewPanel=${shot.panel}&kiosk`;
  let status = 'ok';
  let bytes = 0;
  const file = join(OUT_DIR, `${shot.name}.jpg`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 90_000 });
    await page.waitForTimeout(shot.wait ?? 9000);

    // A Trip layer draws nothing until its clock has run. Play, let the trails
    // build, then shoot — the animation keeps running while the chrome is
    // hidden below, which is exactly what we want in the frame.
    if (shot.animate) {
      const play = page.locator(PLAY_BUTTON).first();
      if (await play.count()) {
        await play.click();
        await page.waitForTimeout(shot.animate);
      } else {
        errors.push('animate requested but no playback control found');
      }
    }

    // kepler overlays both the side panel and the bottom widget on top of a
    // full-width map, so hiding them reveals the map rather than resizing it —
    // no relayout, no reflow, and deck.gl never notices.
    const hide = [
      shot.hideSidePanel === false ? null : SIDE_PANEL,
      shot.hideBottomWidget === false ? null : BOTTOM_WIDGET,
    ].filter(Boolean);
    if (hide.length) {
      await page.addStyleTag({ content: `${hide.join(',')}{display:none!important}` });
      await page.waitForTimeout(300);
    }

    await page.locator(PANEL_SELECTOR).first().screenshot({ path: file, type: 'jpeg', quality: 82 });
    bytes = (await stat(file)).size;
    if (bytes > MAX_BYTES) {
      status = `too big (${Math.round(bytes / 1024)} KB)`;
    }
  } catch (error) {
    status = `FAILED: ${error.message.split('\n')[0]}`;
  }

  page.off('console', onConsole);
  results.push({ name: shot.name, status, kb: Math.round(bytes / 1024), errors });
  const mark = status === 'ok' ? '✓' : '✗';
  console.log(`${mark} ${shot.name.padEnd(28)} ${String(results.at(-1).kb).padStart(4)} KB  ${status}`);
  for (const e of errors.slice(0, 3)) {
    console.log(`    console: ${e.slice(0, 160)}`);
  }
}

await browser.close();

// Any leftover PNGs from an earlier revision of this script would be served
// alongside the JPEGs and silently never referenced.
const stale = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.png') && f !== 'logo.png');
for (const f of stale) {
  await unlink(join(OUT_DIR, f));
  console.log(`  removed stale ${f}`);
}

const failed = results.filter((r) => r.status !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} captured into ${OUT_DIR}`);
if (failed.length) {
  console.log(`Not ok: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
