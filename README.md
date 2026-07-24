# Kepler.gl panel for Grafana

Interactive [kepler.gl](https://kepler.gl) maps inside Grafana dashboards, fed by any Grafana data
source. Built for spatio-temporal mobility data — points, trajectories and origin-destination flows.

An open source alternative to the Foursquare Studio panel, which renders its map in an iframe against
`studio.foursquare.com` and therefore needs a Foursquare account. This one runs kepler.gl inside the
panel: no external service, no account, no Mapbox token.

> **Status: v0.2.** Usable, and pinned to a kepler.gl pre-release because the Flow layer exists
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

The flow layer takes a flat OD table:

```sql
SELECT o.lat AS origin_lat, o.lon AS origin_lon,
       d.lat AS dest_lat,   d.lon AS dest_lon,
       COUNT(*) AS trips
FROM trips t
JOIN zones o ON o.id = t.origin_zone
JOIN zones d ON d.id = t.dest_zone
GROUP BY 1, 2, 3, 4;
```

## Panel options

| Option | Notes |
|---|---|
| **Field mapping** | Per query. Autodetected values appear as placeholders; set one to override. |
| **Show side panel** | kepler's layer and filter panel. Worth hiding on small tiles. |
| **Follow dashboard theme** | Off leaves kepler with its own styling. |
| **Time range sync** | Dashboard drives the map's time filter (default), both directions, or off. Needs a time column. |
| **Base map** | Carto Dark Matter / Positron / Voyager, or a self-hosted `style.json`. |
| **Map configuration** | Save the current layers and filters with the dashboard, or paste one in. |

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

- **v0.2** *(done)* — automatic trip layers; dashboard time range synced with kepler's timeline,
  one-way or both ways.
- **v0.3** — origin-destination flow layer; map filters driving dashboard variables.
- **v1.0** — move to kepler.gl 3.3.0 stable, sign, and submit to the Grafana catalog.

Design notes and the findings from the feasibility spike are in [`docs/`](docs/).

## Licence

Apache-2.0. Bundles [kepler.gl](https://github.com/keplergl/kepler.gl) (MIT) and
[flowmap.gl](https://github.com/visgl/flowmap.gl) (Apache-2.0).
