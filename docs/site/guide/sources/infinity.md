# Infinity — GeoJSON, CSV and WFS

The [Infinity data source](https://grafana.com/grafana/plugins/yesoreyeram-infinity-datasource/)
fetches a URL and flattens the response into rows. It is **in the Grafana catalog and signed**,
which makes it the lowest-friction way to get external data onto the map — no database, no server.

## GeoJSON from a URL

![GeoJSON zones fetched from a URL](/img/source-geojson-url.jpg)

| Setting              | Value           |
| -------------------- | --------------- |
| Type                 | **JSON**        |
| Source               | **URL**         |
| Parser               | **Backend**     |
| URL                  | your `.geojson` |
| Rows / Root selector | `features`      |

Then the columns:

| Selector                | Alias        | Type       |
| ----------------------- | ------------ | ---------- |
| `geometry`              | `geojson`    | **String** |
| `properties.name`       | `name`       | String     |
| `properties.population` | `population` | Number     |

The one that matters is `geometry` → **String**. Infinity serialises the nested geometry object to a
GeoJSON string when the column type is String — no JSONata needed — and the panel autodetects a
column named `geojson` as the geometry.

## CSV

| Setting | Value       |
| ------- | ----------- |
| Type    | **CSV**     |
| Source  | **URL**     |
| Parser  | **Backend** |

::: warning Set the coordinate columns to Number
Infinity's CSV parser types **everything as string** by default. Latitude and longitude columns left
as strings parse to zero, and every point lands at (0, 0) — the cluster in the Gulf of Guinea that
this mistake is famous for.

Set lat/lng and any numeric measure to **Number**. Geometry columns stay **String**.
:::

::: tip DuckDB is the better CSV reader, if you have it
`read_csv_auto` sniffs the types, so numeric columns arrive as numbers and this whole class of
mistake disappears. See [DuckDB](./duckdb-geoparquet#csv).
:::

Both column conventions work. The panel's own roles (`latitude`/`lon`/`geom`/…) are matched first,
and kepler then applies its own on top — so a CSV with `point_latitude` / `point_longitude` renders
even though neither name is in the panel's list, because kepler recognises the `<prefix>_lat` /
`<prefix>_lng` pairing. A column of WKT or GeoJSON strings likewise becomes a polygon layer.

## WFS

A WFS endpoint that speaks GeoJSON is just a URL, and works exactly like the GeoJSON case:

```
https://geoserver.example.org/wfs
  ?service=WFS&version=2.0.0&request=GetFeature
  &typeNames=ns:layer
  &outputFormat=application/json
  &srsName=EPSG:4326
```

::: danger Request WGS84 explicitly
`&srsName=EPSG:4326` is not optional. GeoServer otherwise returns coordinates in the layer's
**native CRS**, which is very often projected metres — and the panel renders WGS84 degrees and does
not reproject, so a UTM easting of 720,000 is read as 720,000 degrees and the data lands nowhere.
:::

DuckDB can also read a WFS directly — GDAL ships a WFS driver — which avoids hand-building the
query string. See [DuckDB](./duckdb-geoparquet#what-it-can-open).

Add `&count=5000` while you are building the panel. A GetFeature with no limit against a large layer
will happily try to send you the whole thing.

## Reading into arrays

Infinity's backend parser can index into arrays with a dotted path, which is what makes APIs that
return parallel arrays usable.

Open-Meteo is the case that matters here: asked for several coordinates it returns a **JSON array of
location objects**, each carrying `latitude`, `longitude` and an `hourly` object of parallel arrays.
Leave the root selector empty so each location becomes a row, and index the first timestep:

| Selector                      | Alias       | Type   |
| ----------------------------- | ----------- | ------ |
| `latitude`                    | `latitude`  | Number |
| `longitude`                   | `longitude` | Number |
| `hourly.wind_speed_10m.0`     | `speed`     | Number |
| `hourly.wind_direction_10m.0` | `direction` | Number |

That yields one row per grid point with a speed and a direction.

::: warning It is not enough on its own for a wind field
Open-Meteo **snaps each requested coordinate to its own model grid**, so a clean 7 × 7 request comes
back as an irregular scatter — 11 distinct latitudes and 46 longitudes across 49 points, measured.
The panel's [velocity field](../data/velocity-fields) detection needs a regular lattice, and an
irregular one produces rows with an empty map and no error.

Fixing it means rounding the coordinates back, which Infinity cannot do. Use
[DuckDB's `read_json_auto`](./duckdb-geoparquet) for that case — see
[Tutorial 6](../../tutorials/wind-field).
:::

## Authentication

Infinity handles Basic, Bearer, API key, OAuth2 and mTLS in the data source configuration. Put
credentials there, never in the URL — a URL lives in the dashboard JSON and travels with every
export and every shared link.

## Provisioned dashboards

If you hand-write dashboard JSON, the Infinity target needs `url_options` with a method:

```json
"url_options": { "method": "GET" }
```

Without it Infinity's frontend throws `Cannot read properties of undefined (reading 'method')` and
the panel shows an error — **even though the backend query succeeds**. The query editor fills this in
for you; it only bites hand-written JSON.

## Caching

Infinity's response is fetched on every query, so a panel with a 10-second refresh is a request every
10 seconds to whoever's server. For a feed that updates hourly, set the dashboard refresh to match,
and be a good citizen about public endpoints.

## When to reach for it

Good for: a public feed, a colleague's file on a web server, a WFS, an internal REST API, anything
you would otherwise have to import first.

Reach for something else when: the data is large (it is fetched and parsed on every query), you
need spatial predicates ([PostGIS](./postgis)), or the file is a CSV, a shapefile, a GeoPackage or
anything columnar — all of which [DuckDB](./duckdb-geoparquet) reads with its types intact.
