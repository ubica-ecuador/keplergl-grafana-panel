# Geometry

A geometry column can hold **GeoJSON, WKT, or raw WKB/EWKB hex**, and all three render. The third
one is the interesting case: it means a plain `SELECT geom` from PostGIS works, with no conversion
function wrapped around it.

![Trajectory lines drawn straight from a PostGIS geometry column — the query selects geometry and nothing wraps it](/img/guide-geometry-ewkb.jpg)

## All of these work

```sql
-- PostGIS: raw geometry, no conversion function at all
SELECT geom, name FROM neighbourhoods;

-- or projected to GeoJSON explicitly, if you prefer
SELECT ST_AsGeoJSON(geom) AS geojson, name FROM neighbourhoods;

-- WKT, from anywhere
SELECT ST_AsText(geom) AS wkt, name FROM neighbourhoods;

-- DuckDB over GeoParquet
SELECT CAST(ST_AsGeoJSON(geometry) AS VARCHAR) AS geojson, name
FROM read_parquet('s3://bucket/zones/*.parquet');
```

## Why raw geometry works

kepler.gl's GeoJSON layer parses **GeoJSON and WKT strings, but not WKB** — a hex WKB column
produces a blank map. Yet WKB hex is exactly what the two sources that matter here hand you: the
Grafana PostgreSQL data source returns PostGIS geometry as **EWKB hex**, and DuckDB's `ST_AsHEXWKB`
over GeoParquet returns **ISO WKB hex**.

So the plugin decodes it, in `src/data/wkbToGeoJson.ts`, before the value ever reaches kepler. The
decoder walks the WKB structure properly — byte order, geometry
type, the SRID/Z/M flags EWKB adds, and nested multi-geometries — and it verifies that it consumed
exactly the whole buffer. A trailing-byte mismatch means the structure was misread, and it returns
nothing rather than emitting a half-parsed geometry.

Anything that is not WKB hex — GeoJSON, WKT, free text — is passed through **untouched** for kepler
to parse itself.

::: tip What this saves you
Without it, every query against a spatial database needs `ST_AsGeoJSON(...)` wrapped around the
geometry, and every view and materialised table needs a GeoJSON twin. With it, the geometry column
you already have is the one you select.
:::

## Detected column names

| Role     | Names                                                                     |
| -------- | ------------------------------------------------------------------------- |
| Geometry | `geom`, `geometry`, `the_geom`, `wkb_geometry`, `geojson`, `wkt`, `shape` |

`the_geom` and `wkb_geometry` are there because they are what GeoServer and `ogr2ogr` produce by
default. Anything else is mapped by hand under **Field mapping → Geometry**.

Internally the column is renamed to `_geojson`, which is kepler's own convention for a geometry
column — which is why kepler builds the layer for it without being told to.

## What can be in it

Whatever GeoJSON can express: points, lines, polygons, and their multi- forms, as well as
collections. Polygons can be extruded into 3D from kepler's layer panel, and lines styled by any
column in the row.

Mixing geometry types in one column works but is rarely what you want: a single layer gets a single
set of styling controls, so points and polygons in the same column share a fill colour and fight
over the radius. Two queries give you two layers and two sets of controls.

## Coordinate reference systems

::: warning WGS84 only
The panel renders **EPSG:4326 longitude/latitude degrees** and does **not** reproject. A geometry
in projected metres will be placed as though those metres were degrees — which puts a UTM easting
of 720,000 somewhere well off the map.
:::

EWKB carries an SRID, and the decoder reads the flag so it can skip the field correctly, but it does
**not** transform coordinates. If your data is not in 4326, project it in the query:

```sql
SELECT ST_Transform(geom, 4326) AS geom, name FROM parcels;
```

For a WFS endpoint the equivalent is asking the server for 4326 explicitly with
`&srsName=EPSG:4326` — see [Infinity](../sources/infinity). GeoServer otherwise returns the layer's
native CRS, which is very often projected metres.

## Volume

Geometry is heavier than points, by a lot: a detailed municipal boundary can be tens of thousands of
coordinates, and a table of a few hundred of them is a large JSON payload before anything is drawn.
Two things help, and both belong in the query rather than in the browser:

```sql
-- simplify to a tolerance appropriate to the zoom you actually use
SELECT ST_Simplify(geom, 0.0005) AS geom, name FROM neighbourhoods;

-- and drop the coordinate precision you cannot see
SELECT ST_ReducePrecision(geom, 0.00001) AS geom, name FROM neighbourhoods;
```

Six decimal places is about 0.1 m at the equator. Anything beyond that is bytes you are paying to
transport and cannot possibly see.
