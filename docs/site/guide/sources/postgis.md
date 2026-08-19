# PostGIS

The path with the least friction: the Grafana PostgreSQL data source returns PostGIS geometry as
**EWKB hex**, and the panel decodes it. So the geometry column you already have is the one you
select.

## Points

```sql
SELECT ST_Y(geom) AS latitude,
       ST_X(geom) AS longitude,
       recorded_at,
       speed_kmh,
       vehicle_type
FROM gps_readings
WHERE $__timeFilter(recorded_at);
```

`$__timeFilter` is Grafana's own macro and does the work the dashboard time picker is for. Use it
even when **Time range sync** is on — the two are complementary: the macro decides what leaves the
database, the sync decides what the map's own brush does with it.

## Geometry, without a conversion function

```sql
SELECT geom, name, population
FROM neighbourhoods;
```

That is the whole query. No `ST_AsGeoJSON`, no view with a GeoJSON twin, no `::text`.

kepler itself renders GeoJSON and WKT but not WKB in any form — a hex WKB column produced a blank
map before the plugin learned to decode it. Both remain available if you prefer them explicit:

```sql
SELECT ST_AsGeoJSON(geom) AS geojson, name FROM neighbourhoods;
SELECT ST_AsText(geom)    AS wkt,     name FROM neighbourhoods;
```

::: warning WGS84 only
The panel renders EPSG:4326 degrees and does not reproject. If your geometry is in a projected CRS —
UTM, a national grid — transform it in the query:

```sql
SELECT ST_Transform(geom, 4326) AS geom, name FROM parcels;
```

:::

## Trajectories

```sql
SELECT vehicle_id AS trip_id,
       ST_Y(geom) AS latitude,
       ST_X(geom) AS longitude,
       ts         AS time,
       speed_kmh,
       mode
FROM vehicle_positions
WHERE $__timeFilter(ts)
ORDER BY vehicle_id, ts;
```

Sorting is not strictly required — the panel sorts within each trip — but it makes the rows legible
in a table panel beside the map, which is worth having while you are building the thing.

## Origin–destination flows

Aggregate before the map. A million journeys between two hundred zones is at most forty thousand
flows, and the map cannot show you the difference.

```sql
SELECT ST_Y(o.centroid) AS origin_lat, ST_X(o.centroid) AS origin_lon,
       ST_Y(d.centroid) AS dest_lat,   ST_X(d.centroid) AS dest_lon,
       COUNT(*)         AS trips
FROM journeys j
JOIN zones o ON o.id = j.origin_zone
JOIN zones d ON d.id = j.dest_zone
WHERE $__timeFilter(j.started_at)
GROUP BY 1, 2, 3, 4;
```

If your zones are H3 cells, skip the centroids and map `origin_h3` / `dest_h3` instead — see
[Origin–destination flows](../data/flows).

## Spatial queries driven by the map

This is where PostGIS earns its place. The map publishes what you clicked, what you drew and what
you are looking at as dashboard variables; a PostGIS query on **another panel** turns those into an
answer.

```sql
-- around the clicked point, with $radius an ordinary dashboard variable
SELECT count(*) AS incidents
FROM incidents
WHERE '$lat' <> ''
  AND ST_DWithin(geom, ST_MakePoint($lng, $lat)::geography, $radius);

-- inside the drawn polygon
SELECT count(*) AS incidents
FROM incidents
WHERE '$area' <> ''
  AND ST_Intersects(geom, ST_GeomFromText($area, 4326));

-- inside the current view
SELECT count(*) AS incidents
FROM incidents
WHERE lng BETWEEN $west AND $east
  AND lat BETWEEN $south AND $north;
```

Note the empty-value guards: before the first click, drawing or load, those variables are empty
strings and the panel runs anyway.

::: danger Never put these in the map's own query
Filtering the map by its own viewport or its own drawn area is a ratchet — zooming out or widening
the shape cannot bring the rows back, because the query no longer returns them. See
[Publishing](../dashboard/publishing).
:::

## Volume

Geometry is the expensive thing here, and the cost is transport rather than rendering: every
coordinate travels to the browser as JSON. Two things belong in the query:

```sql
SELECT ST_ReducePrecision(ST_Simplify(geom, 0.0005), 0.00001) AS geom, name
FROM neighbourhoods;
```

`ST_Simplify` at a tolerance matched to the zoom you actually use, and precision trimmed to six
decimals — about 0.1 m, which is already finer than anything you can see.

For point data past a few hundred thousand rows, aggregate: `GROUP BY` an H3 index, a grid cell, or
a rounded coordinate pair. See [H3 and S2](../data/h3-and-s2).

## Indexes

Nothing here is specific to the panel, but the queries above are the ones that will be slow without:

- A **GiST index** on the geometry column, for `ST_DWithin` and `ST_Intersects`.
- A **btree** on the time column, for `$__timeFilter`.
- A composite `(trip_id, ts)` for trajectory queries, which read in exactly that order.

## Variable quoting

The PostgreSQL data source does **not** add quotes around interpolated variables, so quote them
yourself where the value is a string — `'$area'`, `'$lat'`. This differs from
[DuckDB](./duckdb-geoparquet), which does add them; the same query is not portable between the two.
