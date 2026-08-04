# Kepler.gl panel for Grafana

Interactive [kepler.gl](https://kepler.gl) maps inside Grafana dashboards, fed by any Grafana data
source. Built for spatio-temporal mobility data — points, trajectories and origin-destination flows.

An open source alternative to the Foursquare Studio panel, which renders its map in an iframe against
`studio.foursquare.com` and therefore needs a Foursquare account. This one runs kepler.gl inside the
panel: no external service, no account, no Mapbox token.

> **Status: v0.3.** Usable, and pinned to a kepler.gl pre-release because the Flow layer exists
> nowhere else. Not yet in the Grafana catalog — see [Roadmap](#roadmap).

## What it does today

- **Any data source.** Each query becomes a kepler dataset, so a single panel can overlay several.
- **Column autodetection**, overridable per query — lat/lng, time, trip id, geometry, H3 and
  origin/destination pairs.
- **Geometry from any spatial source** — GeoJSON, WKT, or raw WKB/EWKB hex, so a plain
  `SELECT geom` from PostGIS works with no `ST_AsGeoJSON`. See [Geometry](#geometry).
- **Automatic trip animation** — a query with a trip id and a time becomes an animated kepler
  Trip layer with a playback timeline, no manual layer setup. See [Trajectories](#trajectories).
- **Dashboard time range synced with the map**, one-way or both ways — the time picker drives the
  map's time filter, and optionally the map's time slider drives the dashboard back.
- **Origin-destination flow layers**, automatic — an OD query becomes an animated flow map, no
  manual layer setup. See [Origin-destination flows](#origin-destination-flows).
- **Animated wind and current fields** — a grid of velocities becomes a field of streamlines that
  follows the view, keeping its density and line length steady as you zoom. Several levels can be
  stacked in one map. See [Wind and other velocity fields](#wind-and-other-velocity-fields).
- **Cross-filtering, both ways** — a filter set on the map drives a dashboard variable, and changing
  that variable filters the map. See [Cross-filtering](#cross-filtering).
- **Your layer configuration survives a refresh.** Data is swapped underneath the layers rather than
  the datasets being torn down and rebuilt.
- **Saved map configuration** stored with the dashboard, and configs pasted from kepler.gl,
  Foursquare Studio or Dekart are accepted.
- **Follows the dashboard theme**, base map included.
- **No outbound calls to any vendor.** Base maps come from Carto and can be swapped for a
  self-hosted `style.json`; kepler's icon library ships with the plugin.

## Queries

Nothing special is required — the plugin reads the columns your query already returns. Name them
recognisably and it configures itself; otherwise map them by hand under **Field mapping**.

### Points

```sql
SELECT lat AS latitude,
       lon AS longitude,
       recorded_at,          -- any time column is detected by type
       speed_kmh             -- extra columns become tooltips and colour scales
FROM gps_readings;
```

### Geometry

A geometry column can hold **GeoJSON, WKT, or raw WKB/EWKB hex** — the plugin decodes WKB to GeoJSON
for you, so all of these render:

```sql
-- PostGIS: raw geometry, no conversion function
SELECT geom, name FROM neighbourhoods;

-- or projected explicitly, if you prefer
SELECT ST_AsGeoJSON(geom) AS geojson, name FROM neighbourhoods;

-- DuckDB over GeoParquet on S3
SELECT CAST(ST_AsGeoJSON(geometry) AS VARCHAR) AS geojson, name
FROM read_parquet('s3://bucket/zones/*.parquet');
```

Under the hood kepler.gl itself only renders GeoJSON and WKT; WKB decoding happens in the plugin
(`src/data/wkbToGeoJson.ts`), which is what makes the raw-geometry path work.

### CSV

A CSV source (Infinity's CSV type, or any data source that returns a table) works like any other —
each row becomes a feature. Column detection runs on two levels, so both naming schemes work:

- The plugin's own roles (`latitude`/`lon`/`geom`/`h3`/origin-destination, overridable in **Field
  mapping**).
- kepler.gl's own conventions on top: a `<prefix>_lat` + `<prefix>_lng` pair makes a point layer, and
  a column of WKT or GeoJSON strings makes a polygon layer — verified with `point_latitude` /
  `point_longitude` and an embedded WKT column.

With Infinity, set the lat/lng columns to type **Number** (its CSV parser defaults everything to
string); geometry columns stay **String**.

### GeoJSON from a URL

The [Infinity data source](https://grafana.com/grafana/plugins/yesoreyeram-infinity-datasource/)
(signed, in the catalog) fetches a `.geojson` from any URL and flattens it into rows the panel reads:

- **Type** JSON, **Source** URL, **Parser** Backend, **URL** your `.geojson`
- **Rows/Root** selector: `features`
- **Columns**: `geometry` aliased to `geojson` (type **String**), plus `properties.name`, etc.

Infinity serialises the nested `geometry` object to a GeoJSON string when the column type is String —
no JSONata needed — and the panel autodetects a column named `geojson` as the geometry. Verified
end-to-end against a served FeatureCollection.

A **WFS** endpoint that speaks GeoJSON (`outputFormat=application/json`) is just such a URL and works
the same way — but **request WGS84 explicitly** with `&srsName=EPSG:4326`. GeoServer otherwise
returns coordinates in the layer's native CRS (often projected metres, e.g. UTM), which the map
cannot place. The plugin renders WGS84 lon/lat only; it does not reproject.

### GeoParquet on S3 via DuckDB

The [DuckDB data source](https://github.com/motherduckdb/grafana-duckdb-datasource) reads GeoParquet
directly from S3. Two things to know:

- Load the spatial extension inside the query: `INSTALL spatial; LOAD spatial; SELECT …`.
- Cast `ST_AsGeoJSON(...)` to `VARCHAR` — the data source cannot marshal DuckDB's JSON type.
- That data source needs glibc (Ubuntu/Debian Grafana image); it does **not** run on Alpine.

### Trajectories

Give each row a trip id, a time and a position, and the plugin groups the points into paths and
builds an **animated Trip layer** — one LineString per trip, ordered by time, with a playback
timeline. No manual layer configuration: a query with a trip id, a time and lat/lng is detected as
trips automatically. Map an optional **Altitude** column for 3D paths.

```sql
SELECT vehicle_id AS trip_id,
       ST_Y(geom) AS latitude,
       ST_X(geom) AS longitude,
       ts AS time
FROM vehicle_positions
ORDER BY vehicle_id, ts;
```

The trip id, time, lat/lng and altitude are all overridable under **Field mapping** when the
column names are not recognised.

### Origin-destination flows

A flat OD table becomes an animated **flow layer** automatically — the plugin detects the
origin/destination columns and builds the layer (kepler does not auto-detect flows the way it does
points or trips), then frames the map on it.

```sql
SELECT o.lat AS origin_lat, o.lon AS origin_lon,
       d.lat AS dest_lat,   d.lon AS dest_lon,
       COUNT(*) AS trips
FROM trips t
JOIN zones o ON o.id = t.origin_zone
JOIN zones d ON d.id = t.dest_zone
GROUP BY 1, 2, 3, 4;
```

H3 hexagons work too — map **Origin H3** / **Destination H3** instead of the coordinate pairs. Choose
the line style (straight, curved, animated) under **Flow line style**.

### Wind and other velocity fields

A query that returns a **regular grid of velocities** becomes an animated field of streamlines —
the paths a massless particle would take through it. Nothing to configure: give the plugin
coordinates and a velocity and it builds the field, smooths it, traces the lines and hands them to
kepler's own Trip layer.

```sql
SELECT ts AS "time", lat, lon, speed, direction
FROM wind_grid
WHERE level_hpa = 700
ORDER BY lat, lon;
```

Velocity can arrive either way. **`speed` + `direction`** is what most sources give — Open-Meteo,
GFS, national weather services — and `direction` is read as the meteorological convention, the
bearing the wind blows *from*. **`u` + `v`** components work too, including the GRIB2 short names
`ugrd`/`vgrd`, so a table converted straight from GFS needs no renaming.

A `trip_id` column disqualifies the query: a GPS trace that happens to carry a `speed` column is a
trajectory, not a field, and shredding it into streamlines would draw lines that mean nothing.

Rows are one cell of the grid; the grid itself is inferred, so the query may return them in any
order. When it spans several timesteps the earliest is used — select a single one to be explicit.
Cells the query omits are treated as **holes**, not as calm air, and streamlines stop at their edge.
That is how a level that runs below ground is excluded: omit those cells and the lines end at the
mountains instead of drawing weather over rock.

The lines follow the view. Density and on-screen length hold steady as you zoom, because the field
is re-traced whenever the map settles — a fixed budget of lines per screen, each a fixed number of
pixels long. Several velocity queries in one panel share that budget between them.

How large that budget is, **Wind line density** decides. There is no figure that suits every map: a
country covering a third of the view wants more lines than a pair of three-kilometre patches around
two weather stations, and a field of parallel arrows reads as a solid block at a density a swirling
one reads well at. Lower it when the field looks matted, raise it when it looks sparse.

**Several levels at once:** one query per level, in the same panel. Each becomes its own layer. To
separate them in the vertical, return a height column and map it to **Altitude** under *Field
mapping*, then tilt the camera with the 3D control. Height is opt-in on purpose — an `elevation`
column mapped by accident lifts a layer kilometres into the air. Expect to exaggerate the height a
long way: pressure levels a few kilometres apart are invisible over a country hundreds of kilometres
wide.

Colour, width and **Trail Length** live in kepler's own layer settings. A short trail reads as
drifting particles, a long one as complete streamlines. Every line carries its mean `speed`, so
*Color Based On → speed* works.

### Cross-filtering

The map and a **dashboard variable** stay in sync, both ways. A select, multi-select or text filter
set on the map writes its value to the variable, so filtering on the map filters every other panel;
and changing that variable — from its picker or another panel — applies the matching filter on the
map. Add a template variable, then map a filtered column to it under **Cross-filtering**.

The variable is read from the URL, which is what lets the map react even when its own query does not
use the variable.

## Panel options

| Option                     | Notes                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| **Field mapping**          | Per query. Autodetected values appear as placeholders; set one to override.                     |
| **Show side panel**        | kepler's layer and filter panel. Worth hiding on small tiles.                                   |
| **Follow dashboard theme** | Off leaves kepler with its own styling.                                                         |
| **Time range sync**        | Dashboard drives the map's time filter (default), both directions, or off. Needs a time column. |
| **Flow line style**        | Straight, curved or animated lines for origin-destination flow layers.                          |
| **Cross-filtering**        | Map a kepler filter to a dashboard variable to cross-filter other panels.                       |
| **Base map**               | Carto Dark Matter / Positron / Voyager, or a self-hosted `style.json`.                          |
| **Map configuration**      | Save the current layers and filters with the dashboard, or paste one in.                        |

Saving is explicit rather than automatic: the configuration is a sizeable blob that lands in the
dashboard JSON, and rewriting it on every pan would churn the dashboard for nothing.

## Installing

Requires **Grafana `>=12.0.10 <12.1 || >=12.1.7 <12.2 || >=12.2.5`**. Those floors are not arbitrary:
Grafana only added `react/jsx-runtime` to its module import map in those patches, and the plugin
fails to load below them.

The plugin is unsigned while it is pre-1.0, so allow it explicitly:

```ini
[plugins]
allow_loading_unsigned_plugins = ubica-keplergl-panel
```

### Hardened Grafana

With `content_security_policy = true` the map loads and its Web Workers start, but `connect-src`
blocks the base map. MapLibre fetches styles, sprites, glyphs and tiles over XHR, so they all fall
under that directive:

```ini
content_security_policy_template = """...connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com ...;"""
```

Or point **Base map** at a `style.json` on your own network and skip this entirely.

## Development

```bash
npm install
npm run dev          # watch build
npm run server       # Grafana 12.0.10 on :3000, plus a strict-CSP one on :3001
npm run test:ci      # unit tests
npm run e2e          # end-to-end against the running Grafana
```

Requires Node 22+. If you have changed your dev Grafana's admin password, pass it through:
`GRAFANA_ADMIN_PASSWORD=… npm run e2e`.

`npm run verify:spike` drives a browser against the provisioned dashboard and reports what actually
reached the map — useful when a change breaks rendering without breaking a test.

> Do not `rm -rf dist` while the dev containers are running: `dist` is bind-mounted, and deleting it
> leaves the containers serving a stale inode. `npm run build` cleans it correctly.

## Roadmap

- **v0.2** _(done)_ — automatic trip layers; dashboard time range synced with kepler's timeline,
  one-way or both ways.
- **v0.3** _(done)_ — origin-destination flow layers; map filters driving dashboard variables.
- **v1.0** — move to kepler.gl 3.3.0 stable, sign, and submit to the Grafana catalog.

Design notes and the findings from the feasibility spike are in [`docs/`](docs/).

## Licence

Apache-2.0. Bundles [kepler.gl](https://github.com/keplergl/kepler.gl) (MIT) and
[flowmap.gl](https://github.com/visgl/flowmap.gl) (Apache-2.0).
