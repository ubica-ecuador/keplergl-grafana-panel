#!/usr/bin/env node
/**
 * Builds the daily rainfall rasters the precipitation dashboard draws.
 *
 * CHIRPS publishes one cloud-optimised GeoTIFF per day, readable over plain
 * HTTP with range requests — so nothing is ever downloaded whole here. For each
 * day this asks DuckDB to read the nine tiles that cover South America straight
 * from the remote file, quantise them, and write a small COG into the volume
 * the tile server reads. The heavy lifting happens inside the database; this
 * script only sequences it.
 *
 * Two things are deliberate and lossy, and both are visible in the output:
 *
 *  - **Rain is quantised to uint16, 0–100 mm stretched over the integer
 *    range.** kepler cannot draw a float raster at all — it has no maximum
 *    value for the float types, gives up on the pixel range, and leaves a layer
 *    that renders nothing and reports nothing. Above 100 mm in a day the image
 *    saturates; the statistics beside it are computed from the original floats,
 *    so the real figure is never lost.
 *  - **Zero becomes nodata.** Dry ground and ocean then read as transparent
 *    rather than as a black sheet over the basemap, which is the difference
 *    between a map of rainfall and a map of a rectangle.
 *
 * The statistics are computed from the *original* float rasters, before any of
 * that, and written once to a parquet the dashboard reads: recomputing them per
 * load would mean re-reading sixty remote files on every refresh, and reading
 * them back from the quantised COGs would measure the compromise instead of the
 * weather.
 *
 *   node scripts/fetch-chirps.mjs [--from 2024-01-01] [--days 60]
 *
 * Grafana at :3002 does the talking to DuckDB, so the bench must be up.
 */

const GRAFANA = process.env.GRAFANA_URL ?? 'http://localhost:3002';
const AUTH = process.env.GRAFANA_AUTH ?? 'admin:ubica';

/** South America, give or take: the window every day is cut to. */
const BBOX = { west: -82, south: -56, east: -34, north: 13 };

/** Above this many millimetres in one day the raster saturates. */
const MAX_MM = 100;

/** Where the derived rasters land — shared with the tile server, read-only there. */
const OUT_DIR = '/derived';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const from = argOf('from', '2024-01-01');
const days = Number(argOf('days', '60'));

/** CHIRPS names its files by date, so no catalogue lookup is needed. */
function sourceUrl(date) {
  const [y, m, d] = date.split('-');
  return `https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/cogs/p05/${y}/chirps-v2.0.${y}.${m}.${d}.cog`;
}

function eachDay(start, count) {
  const out = [];
  const at = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.push(at.toISOString().slice(0, 10));
    at.setUTCDate(at.getUTCDate() + 1);
  }
  return out;
}

async function query(sql) {
  const response = await fetch(`${GRAFANA}/api/ds/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(AUTH).toString('base64')}`,
    },
    body: JSON.stringify({
      queries: [
        {
          refId: 'A',
          datasource: { uid: 'duckdb', type: 'motherduck-duckdb-datasource' },
          rawSql: sql,
          format: 1,
          intervalMs: 60000,
          maxDataPoints: 100,
        },
      ],
      from: 'now-1h',
      to: 'now',
    }),
  });
  const body = await response.json();
  const result = body?.results?.A;
  if (result?.error) {
    throw new Error(result.error);
  }
  const frame = result?.frames?.[0];
  if (!frame) {
    return [];
  }
  const names = frame.schema.fields.map((field) => field.name);
  const columns = frame.data.values;
  const rows = [];
  for (let i = 0; i < (columns[0]?.length ?? 0); i++) {
    rows.push(Object.fromEntries(names.map((name, c) => [name, columns[c][i]])));
  }
  return rows;
}

/**
 * The preamble every statement needs.
 *
 * The CA bundle is not optional: the GDAL inside the raster extension looks for
 * it at a RedHat path, the image is Ubuntu, and without this every read over
 * https dies with a curl error rather than anything mentioning certificates.
 */
const PRELUDE = `LOAD raster; LOAD spatial;
SELECT RT_GdalConfig('CURL_CA_BUNDLE', '/etc/ssl/certs/ca-certificates.crt');`;

const TILES_OVER_SOUTH_AMERICA = `ST_Intersects(geometry, ST_MakeEnvelope(${BBOX.west}, ${BBOX.south}, ${BBOX.east}, ${BBOX.north}))`;

/**
 * Whether a day has already been built.
 *
 * Checked rather than assumed, for two reasons: a run that stops half way can
 * simply be run again, and `COPY` refuses to overwrite an existing raster —
 * it writes the file and then fails renaming its temporary, which would count a
 * finished day as a failure.
 */
async function alreadyBuilt(out) {
  const rows = await query(`SELECT count(*) AS n FROM glob('${out}');`);
  return Number(rows[0]?.n ?? 0) > 0;
}

async function convert(date) {
  const url = `/vsicurl/${sourceUrl(date)}`;
  const out = `${OUT_DIR}/chirps-${date}.tif`;
  if (await alreadyBuilt(out)) {
    return out;
  }
  await query(`${PRELUDE}
COPY (
  SELECT geometry,
         RT_CubeSetNoData(
           RT_Cube2TypeUInt16(
             RT_CubeMultiply(RT_CubeMin(RT_CubeMax(databand_1, 0.0), ${MAX_MM}.0), ${(65535 / MAX_MM).toFixed(2)})),
           0.0) AS mm
  FROM RT_Read('${url}')
  WHERE ${TILES_OVER_SOUTH_AMERICA}
)
TO '${out}'
WITH (FORMAT RASTER, DRIVER 'COG', SRS 'EPSG:4326', GEOMETRY_COLUMN 'geometry',
      DATABAND_COLUMNS ['mm'],
      -- AVERAGE, not the default nearest. Rain covers about a tenth of the
      -- region on a given day, so reduced levels built by picking one source
      -- pixel come out empty: at the zoom that shows the whole continent the
      -- map was blank while the file itself was full. Averaging carries the
      -- wet cells up through the pyramid.
      CREATION_OPTIONS ('COMPRESS=DEFLATE', 'OVERVIEW_RESAMPLING=AVERAGE'));
SELECT 1 AS ok;`);
  return out;
}

/**
 * The day's rainfall, measured on the original floats.
 *
 * CHIRPS marks the ocean with -9999 and declares no nodata value, so the mask
 * is arithmetic: clamping at zero turns sea into "no rain", and comparing
 * against zero counts the cells that actually got some. That gives two figures
 * that mean something on their own — how hard it rained where it rained, and
 * how much of the region was under rain at all — rather than an average diluted
 * by every dry pixel and every square kilometre of Pacific.
 */
async function measure(date) {
  const url = `/vsicurl/${sourceUrl(date)}`;
  const [row] = await query(`${PRELUDE}
WITH t AS (SELECT databand_1 AS b FROM RT_Read('${url}') WHERE ${TILES_OVER_SOUTH_AMERICA})
SELECT (RT_CubeStats_Agg(RT_CubeMax(b, 0.0), 0)).sum      AS total_mm,
       (RT_CubeStats_Agg(RT_CubeGreater(b, 0.0), 0)).sum  AS wet_cells,
       (RT_CubeStats_Agg(b, 0)).valid_count               AS cells,
       (RT_CubeStats_Agg(b, 0)).maximum                   AS max_mm
FROM t;`);
  return row;
}

async function writeIndex(rows) {
  const values = rows
    .map(
      (r) =>
        `(DATE '${r.date}', '${r.file}', ${r.intensity.toFixed(3)}, ${r.wetShare.toFixed(5)}, ${r.maxMm.toFixed(1)})`
    )
    .join(',\n    ');
  await query(`COPY (
  SELECT * FROM (VALUES
    ${values}
  ) AS t(dia, raster_url, intensidad_mm, fraccion_con_lluvia, max_mm)
) TO '${OUT_DIR}/chirps-index.parquet' (FORMAT PARQUET);
SELECT 1 AS ok;`);
}

const dates = eachDay(from, days);
console.log(`CHIRPS · ${dates.length} días desde ${from} · Sudamérica`);

const index = [];
for (const [i, date] of dates.entries()) {
  const started = Date.now();
  try {
    const file = await convert(date);
    const stats = await measure(date);
    const wet = Number(stats.wet_cells) || 0;
    index.push({
      date,
      file,
      intensity: wet > 0 ? Number(stats.total_mm) / wet : 0,
      wetShare: wet / Number(stats.cells),
      maxMm: Number(stats.max_mm),
    });
    const s = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `  [${String(i + 1).padStart(3)}/${dates.length}] ${date}  ` +
        `${index.at(-1).intensity.toFixed(1)} mm donde llovió · ` +
        `${(index.at(-1).wetShare * 100).toFixed(0)} % del área · máx ${index.at(-1).maxMm.toFixed(0)} mm  (${s}s)`
    );
  } catch (error) {
    // A missing day is normal near the present: the final product lags real
    // time by weeks. Skipping keeps the run going and leaves a gap in the
    // timeline, which is the honest thing for the map to show.
    console.log(
      `  [${String(i + 1).padStart(3)}/${dates.length}] ${date}  — sin datos (${String(error).slice(0, 80)})`
    );
  }
}

if (index.length === 0) {
  console.error('Ningún día pudo prepararse.');
  process.exit(1);
}

await writeIndex(index);
console.log(`\nListo: ${index.length} días en ${OUT_DIR}, índice en ${OUT_DIR}/chirps-index.parquet`);
