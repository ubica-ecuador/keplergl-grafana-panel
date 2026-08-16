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
- **No outbound calls to any vendor.** Base maps come from Carto, or Esri for the satellite one, and
  can be swapped for a self-hosted `style.json`; kepler's icon library ships with the plugin.
- **Esri's terms of use.** The satellite imagery comes from Esri's public
  `services.arcgisonline.com` endpoint, whose terms ask for an ArcGIS account for production use —
  installs that need a cleaner footing should point **Base map** at their own `style.json`.

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
directly, locally or from S3. Four things to know:

- Load the spatial extension. From v0.4.5 the data source has an **Init SQL** field, so
  `INSTALL spatial; LOAD spatial;` belongs there rather than at the head of every query.
- **No `ST_GeomFromWKB`.** With spatial loaded, a GeoParquet geometry column arrives as a native
  `GEOMETRY` carrying its CRS — passing it through `ST_GeomFromWKB` is a binder error, not a no-op.
- Cast `ST_AsGeoJSON(...)` to `VARCHAR` — the data source cannot marshal DuckDB's JSON type.
- It needs glibc (Ubuntu/Debian Grafana image); it does **not** run on Alpine. It is also not in the
  Grafana catalog, so it installs from its release zip and is unsigned.

```sql
SELECT name, population,
       CAST(ST_AsGeoJSON(geometry) AS VARCHAR) AS geojson
FROM read_parquet('s3://bucket/zones/*.parquet')
```

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
bearing the wind blows _from_. **`u` + `v`** components work too, including the GRIB2 short names
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
separate them in the vertical, return a height column and map it to **Altitude** under _Field
mapping_, then tilt the camera with the 3D control. Height is opt-in on purpose — an `elevation`
column mapped by accident lifts a layer kilometres into the air. Expect to exaggerate the height a
long way: pressure levels a few kilometres apart are invisible over a country hundreds of kilometres
wide.

Colour, width and **Trail Length** live in kepler's own layer settings. A short trail reads as
drifting particles, a long one as complete streamlines. Every line carries its mean `speed`, so
_Color Based On → speed_ works.

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
| **Base map**               | Carto Dark Matter / Positron / Voyager, Esri satellite, or a self-hosted `style.json`.          |
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
content_security_policy_template = """...connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://services.arcgisonline.com ...;"""
```

The Esri host serves only the **Satellite (Esri)** base map — leave it out if you never select it.
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

### Sources bench (:3002)

`npm run server` deliberately gives you a plain Grafana with no third-party data sources. To exercise
the file formats — GeoParquet, GeoJSON, CSV — bring up the bench instead:

```bash
npm run server:sources   # Grafana on :3002 with DuckDB + Infinity installed
npm run verify:sources   # drives a browser over its dashboard, one line per panel
```

It is a separate service rather than a flag on the main one, because the DuckDB data source is linked
against glibc and the default image is Alpine — the bench runs the `-ubuntu` tag. Keeping it apart
leaves `:3000` as the plainest install we ship to, which is the point of pinning it to the floor of
the supported range.

Both data sources install declaratively through `GF_INSTALL_PLUGINS`, so the first start needs
outbound internet and pulls ~140 MB (the DuckDB zip bundles an engine per platform). It lands in a
named volume, so that cost is paid once.

The fixtures live in `testdata/` — real GeoParquet with WKB geometry and EPSG:4326 metadata, the same
features as GeoJSON, and two CSVs. A `sources-data` container serves them over HTTP so Infinity
exercises a genuine URL fetch rather than inline data; DuckDB reads the parquet off the same
directory, mounted at `/testdata`. Regenerate them with `python3 testdata/make-testdata.py` (needs
geopandas) only if the sample data itself must change.

Its dashboard sets no layers — what renders is what autodetection alone produces — so it doubles as a
check that a bare query still finds its geometry. Points draw at kepler's default radius, which is
small; bump it in the layer panel if you are eyeballing them.

The bench also carries **Terremotos — espacio-temporal** (`earthquakes.json`): a month of global
seismicity read as **remote** GeoParquet over HTTPS, sized and coloured by magnitude, with the time
slider driving a summary and a table beside it. Three things it demonstrates that the local fixtures
cannot:

- **Time range sync set to `variables`, not `toMap`.** Driving the dashboard range from the map would
  re-run the query, and every event outside the new window would leave the browser — the histogram
  under the slider rescales and the window can never be widened again from the map. Variables keep
  the whole month loaded and cost only the panels that read them.
- **`SET force_download = true` before reading a generated URL.** That endpoint builds the parquet per
  request, so successive ranged reads see different ETags and DuckDB aborts with "the remote file has
  changed". Against a stable object store you want the opposite — ranged reads are the point.
- **Do not quote a variable in SQL.** The data source interpolates with Grafana's SQL-string format,
  which adds the quotes itself; `'$var'` arrives as `''value''` and fails to parse. Write `$var`, and
  wrap it in `try_cast(... AS TIMESTAMPTZ)` so the empty value before the first scrub falls back to a
  bound rather than erroring.

> Do not `rm -rf dist` while the dev containers are running: `dist` is bind-mounted, and deleting it
> leaves the containers serving a stale inode. `npm run build` cleans it correctly.

### Provisioned dashboards

`provisioning/dashboards/` is mounted into the dev Grafana, so these appear on a plain
`npm run server`. Each one exercises a different part of the panel: `dashboard` (trips and EWKB
geometry), `timesync` and `timevars` (time coupling), `varsync` (cross-filtering), `flows` (OD).

**Kepler.gl layer gallery** (`layers.json`) is the widest of them: every layer type the panel can
build from query rows, on synthetic data, one map each, with the rows behind each layer in a table
beside it. Useful for seeing at a glance what the plugin draws, and for spotting what a kepler.gl
version bump broke. Three things about it are deliberate:

- **Open at most two rows at a time.** Each map holds two WebGL contexts — MapLibre's and
  deck.gl's — and browsers cap the total at around sixteen, so thirteen maps at once blank the
  oldest. The rows are collapsed for that reason, and collapsing one releases its contexts.
- **It does not follow the Grafana theme.** Pinning a layer type needs a saved map configuration,
  and a saved config names its own base map and wins over the panel option.
- **Six layer types are missing** — `vectorTile`, `rasterTile`, `wms`, `tile3d`, `bitmap` and `3D`.
  They are configured with a URL rather than with data, so no query can drive them and demonstrating
  them would mean calling a third-party service.

## Roadmap

- **v0.2** _(done)_ — automatic trip layers; dashboard time range synced with kepler's timeline,
  one-way or both ways.
- **v0.3** _(done)_ — origin-destination flow layers; map filters driving dashboard variables.
- **v1.0** — move to kepler.gl 3.3.0 stable, sign, and submit to the Grafana catalog.

Design notes and the findings from the feasibility spike are in [`docs/`](docs/).

## Licence

Apache-2.0. Bundles [kepler.gl](https://github.com/keplergl/kepler.gl) (MIT) and
[flowmap.gl](https://github.com/visgl/flowmap.gl) (Apache-2.0).
