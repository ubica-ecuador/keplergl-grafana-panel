# DuckDB — parquet, CSV and GeoJSON

The [MotherDuck DuckDB data source](https://github.com/motherduckdb/grafana-duckdb-datasource) reads
spatial files directly — from disk, from S3, or over plain HTTPS — with no import step and no
database to keep in sync. GeoParquet is the headline case, but the same data source also reads CSV,
GeoJSON, shapefiles and about fifty other formats, which makes it the general answer to _"I have a
file and I want it on a map"_.

![GeoParquet zones read by DuckDB](/img/source-geoparquet-zones.jpg)

## Before you start

Two things about the data source itself, both of which will waste an afternoon otherwise.

::: warning glibc, not Alpine
The DuckDB data source is linked against glibc and will **not run on an Alpine-based Grafana
image**. Use a Debian or Ubuntu one — `grafana/grafana:12.0.10-ubuntu`.

It is also not in the Grafana catalog, so it installs from a release zip and is unsigned. It needs
its own listing in `allow_loading_unsigned_plugins` — see [Install](../install) for this panel's own
catalog and signing status, which is independent of DuckDB's.
:::

Leave the data source's **path** blank for an in-memory database. That is all you need for
`read_parquet(...)`; a `.duckdb` file is only for persisting your own tables.

## Load the spatial extension once

From v0.4.5 the data source has an **Init SQL** field, and it runs per connection. Put the extension
loading there rather than at the head of every query:

```sql
INSTALL spatial; LOAD spatial;
INSTALL httpfs;  LOAD httpfs;   -- only if you read from S3 or HTTPS
```

Extensions do not persist across a backend restart, which is exactly why Init SQL exists.

## Geometry

```sql
SELECT name,
       population,
       CAST(ST_AsGeoJSON(geometry) AS VARCHAR) AS geojson
FROM read_parquet('/data/zones.parquet');
```

Two details in that one line, and both are load-bearing.

::: danger Do not wrap it in ST_GeomFromWKB
With `spatial` loaded, a GeoParquet geometry column arrives as a native `GEOMETRY` carrying its CRS
— not as a `BLOB`. `ST_GeomFromWKB(geometry)` is therefore a **binder error**, not a harmless no-op:

```
No function matches … st_geomfromwkb(GEOMETRY('EPSG:4326'))
```

`ST_AsGeoJSON(geometry)` is the whole conversion.
:::

**Cast to `VARCHAR`.** `ST_AsGeoJSON` returns DuckDB's JSON type, which the data source's Go driver
cannot scan into a string — you get `unsupported Scan … map[string]interface{}`.

`ST_AsText` (WKT) and `ST_AsHEXWKB` (WKB hex) also render; the panel decodes the latter.

## Points

If the parquet already has coordinate columns, no extension is needed at all:

```sql
SELECT name, category, visitors,
       point_latitude  AS latitude,
       point_longitude AS longitude
FROM read_parquet('/data/points.parquet');
```

![GeoParquet points read by DuckDB](/img/source-geoparquet-points.jpg)

Otherwise take them from the geometry:

```sql
SELECT name, ST_Y(geometry) AS latitude, ST_X(geometry) AS longitude
FROM read_parquet('/data/points.parquet');
```

## CSV

`read_csv_auto` sniffs the types for you, which is the reason to prefer this over
[Infinity's CSV parser](./infinity#csv) when you have DuckDB available:

```sql
SELECT name, category, visitors,
       point_latitude  AS latitude,
       point_longitude AS longitude
FROM read_csv_auto('/data/points.csv');
```

Numeric columns come back as numbers. Infinity types every CSV column as **string** unless you set
each one by hand — the mistake that puts every point at (0, 0) — and here that class of error simply
does not arise.

It reads over HTTP as well, with `httpfs` loaded:

```sql
SELECT * FROM read_csv_auto('https://example.org/data/points.csv');
```

Override the sniffer when it guesses wrong:

```sql
SELECT * FROM read_csv_auto('/data/points.csv',
                            types = {'zone_id': 'VARCHAR'});   -- keep the leading zeros
```

## GeoJSON, shapefiles and the rest

The `spatial` extension bundles GDAL, so `ST_Read` opens whatever GDAL opens:

```sql
SELECT name, population,
       CAST(ST_AsGeoJSON(geom) AS VARCHAR) AS geojson
FROM ST_Read('/data/zones.geojson');
```

`ST_Read` names the geometry column **`geom`** and adds an `OGC_FID`. It reads over HTTP too:

```sql
SELECT name, CAST(ST_AsGeoJSON(geom) AS VARCHAR) AS geojson
FROM ST_Read('https://example.org/data/zones.geojson');
```

::: danger Never `SELECT *` from ST_Read
It looks like it works. The query succeeds, the rows arrive, and there is a column called `geom` —
which is a name the panel detects as geometry. **And nothing renders.**

The raw `GEOMETRY` marshals to the frontend as raw WKB _bytes_, not hex and not text. The panel
decodes WKB **hex**; it cannot do anything with mangled binary, and there is no error to tell you so.

Always convert explicitly — `CAST(ST_AsGeoJSON(geom) AS VARCHAR)`, `ST_AsText(geom)` or
`ST_AsHEXWKB(geom)`.
:::

### What it can open

Fifty-three drivers in the build this plugin was tested against. Ask your own install:

```sql
SELECT short_name FROM ST_Drivers() WHERE can_open ORDER BY short_name;
```

The ones you are most likely to want: **GeoJSON**, **ESRI Shapefile**, **GPKG**, **FlatGeobuf**,
**KML**, **GPX**, **GML**, **TopoJSON**, **OpenFileGDB**, **MVT**, **PMTiles**, **OSM**, **GTFS**,
**XLSX** — and **WFS**, which means DuckDB can read a WFS service directly rather than going through
[Infinity](./infinity#wfs).

A shapefile is the case worth calling out, since it arrives as four or five sibling files: point
`ST_Read` at the `.shp` and it finds the rest.

```sql
SELECT CAST(ST_AsGeoJSON(geom) AS VARCHAR) AS geojson, *
FROM ST_Read('/data/parcels.shp');
```

::: tip Reproject on the way in
Unlike the panel, DuckDB _can_ reproject. If the file is not in WGS84:

```sql
SELECT CAST(ST_AsGeoJSON(ST_Transform(geom, 'EPSG:32717', 'EPSG:4326')) AS VARCHAR) AS geojson
FROM ST_Read('/data/parcels.shp');
```

That is often the tidiest place to fix a projected shapefile — no GIS software, no conversion step,
just the query.
:::

## Reading from S3 and HTTPS

```sql
-- an object store
SELECT name, CAST(ST_AsGeoJSON(geometry) AS VARCHAR) AS geojson
FROM read_parquet('s3://bucket/zones/*.parquet');

-- a plain HTTPS URL
SELECT * FROM read_parquet('https://example.org/data/quakes.parquet');
```

Both need `httpfs`. Credentials for a private bucket go in the data source configuration, not in the
query.

### force_download, and when you want the opposite

```sql
SET force_download = true;
```

::: tip This is not a performance tweak
It changes _how_ the file is read. By default DuckDB issues **ranged requests** and reads only the
parquet pages it needs — which is the entire point of parquet on an object store, and you want it.

Set `force_download` when the endpoint **builds the file per request**: successive ranged reads then
see different ETags and DuckDB aborts with _"the remote file has changed"_. One whole-file GET
sidesteps it. On a stable object store, leave it off.
:::

The plugin's own earthquakes bench sets it, because its source generates the parquet on demand — at
378 KB, downloading the lot is free.

![Global seismicity from remote GeoParquet](/img/source-earthquakes.jpg)

## Variables: do not quote them

::: warning
The DuckDB data source interpolates variables with Grafana's SQL-string format, which **adds the
quotes itself**. Write `$var`, not `'$var'` — the latter arrives as `''value''` and fails to parse.

Then guard the empty value with a cast that tolerates it:

```sql
WHERE ts >= coalesce(try_cast($mapFrom AS TIMESTAMPTZ), '-infinity')
  AND ts <  coalesce(try_cast($mapTo   AS TIMESTAMPTZ), 'infinity')
```

:::

This is the opposite of the [PostgreSQL data source's](./postgis#variable-quoting) behaviour. A query
is not portable between the two without changing the quoting.

## Provisioned dashboards

If you hand-write dashboard JSON rather than using the query editor, the DuckDB target needs
`"format": 1` — the query format is a **numeric enum** and `QueryFormat.Table` is `1`. The string
`"table"` produces an empty frame with no error.

## When to reach for it

|                    | DuckDB                                     | Infinity                        | PostGIS             |
| ------------------ | ------------------------------------------ | ------------------------------- | ------------------- |
| Data lives in      | files — local, S3, HTTPS                   | any URL                         | a database          |
| Formats            | parquet, CSV, GeoJSON, shapefile, ~50 more | JSON, CSV, XML, GraphQL         | whatever you loaded |
| Column types       | sniffed, correctly                         | strings unless you set each one | the database's      |
| Reprojection       | yes, `ST_Transform`                        | no                              | yes                 |
| Spatial predicates | yes                                        | no                              | yes, with indexes   |
| In the catalog     | no, and unsigned                           | **yes**, signed                 | yes                 |
| Runs on Alpine     | **no**, glibc only                         | yes                             | yes                 |

For a periodically-refreshed extract that many dashboards read, DuckDB over parquet is hard to beat.
For anything transactional, use the database.
