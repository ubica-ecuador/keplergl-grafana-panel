# Tutorial 5 — Click the map, query a radius

Click anywhere on the map and another panel answers a spatial question about that spot: how many
earthquakes within 500 km, and where. The map itself does no spatial work — it publishes a
coordinate, and the database does the rest. About twenty-five minutes.

**You need:** the [DuckDB data source](../guide/sources/duckdb-geoparquet), which is outside the
Grafana catalog and glibc-only. Read that page first if you have not installed it.

## The shape of it

| Piece          | Role                                            |
| -------------- | ----------------------------------------------- |
| `$lat`, `$lng` | written by the map when you click               |
| `$radio`       | an ordinary text box you set                    |
| Query A        | the earthquakes, drawn as points                |
| Query B        | the circle around the click, drawn as a polygon |
| Query C        | the events inside the circle                    |

The circle comes **back to the map as one more query**, which is the trick worth taking away: the
panel needs no spatial logic of its own, because the database can draw as well as count.

## 1. Variables

**Dashboard settings → Variables**, three text boxes:

| Name    | Default |
| ------- | ------- |
| `lat`   | `-0.9`  |
| `lng`   | `-79.5` |
| `radio` | `500`   |

Defaults matter here — they are what the dashboard shows before anyone clicks.

## 2. The data (query A)

New panel → DuckDB → **Kepler Geospatial Maps**. In the data source's **Init SQL**, once:

```sql
INSTALL httpfs; LOAD httpfs;
INSTALL spatial; LOAD spatial;
```

Then query A:

```sql
SET force_download = true;

SELECT place, mag, depth_num AS depth,
       event_time_utc_date_fmt AS time,
       latitude_num  AS latitude,
       longitude_num AS longitude
FROM read_parquet('https://your-host/quakes.parquet');
```

::: tip force_download is not tuning
By default DuckDB issues ranged requests and reads only the parquet pages it needs — which is the
point of parquet on an object store. Set `force_download` only when the endpoint **builds the file
per request**: successive ranged reads then see different ETags and DuckDB aborts with _"the remote
file has changed"_. Against a stable bucket, leave it off.
:::

## 3. Publish the clicked coordinate

**Panel options → Cross-filtering → + Add mapping**:

| Field  | Value           |
| ------ | --------------- |
| Source | **Coordinates** |
| Lat    | `lat`           |
| Lng    | `lng`           |

Click the map. The two variables take the position, rounded to six decimals — about 0.1 m, which is
fine enough for any query and coarse enough that re-clicking the same spot does not re-run the
dashboard.

The panel switches kepler's **coordinate interaction** on by itself for this, and switches it back on
if you turn it off. Clicking again unpins the marker, but the variables **keep the last position** —
so the consuming query never runs with an empty centre.

## 4. Draw the circle (query B)

Add a second query to the **same panel**. It returns one row: a polygon.

```sql
WITH params AS (
  SELECT try_cast($lat AS DOUBLE) AS lat0,
         try_cast($lng AS DOUBLE) AS lng0,
         coalesce(try_cast($radio AS DOUBLE), 500) / 6371.0 AS d
),
pts AS (
  SELECT deg,
         asin(sin(radians(lat0)) * cos(d) + cos(radians(lat0)) * sin(d) * cos(radians(deg))) AS lat2,
         lat0, lng0, d
  FROM params, (SELECT unnest(generate_series(0, 360, 6)) AS deg)
  WHERE lat0 IS NOT NULL AND lng0 IS NOT NULL
),
ring AS (
  SELECT deg,
         degrees(lat2) AS lat_deg,
         lng0 + degrees(atan2(sin(radians(deg)) * sin(d) * cos(radians(lat0)),
                              cos(d) - sin(radians(lat0)) * sin(lat2))) AS lng_deg
  FROM pts
)
SELECT ST_AsHEXWKB(ST_GeomFromText(
         'POLYGON((' || string_agg(round(lng_deg, 5) || ' ' || round(lat_deg, 5), ',' ORDER BY deg) || '))'
       )) AS geom,
       'radius' AS name
FROM ring
HAVING count(*) > 0;
```

Three things in there are deliberate.

**It is a geodesic ring, not `ST_Buffer`.** `ST_Buffer` is planar and works in degrees, so at 500 km
it draws an ellipse that is wrong by a visible margin at anything but the equator. The spherical
destination formula per bearing, every 6°, draws the circle that is actually 500 km away.

**`try_cast` and `coalesce`.** Before the first click the variables are empty strings. `try_cast`
turns that into `NULL`, the `WHERE` drops every row, and the query returns nothing — so no circle,
rather than an error.

**Do not quote the variables.** The DuckDB data source interpolates with Grafana's SQL-string format
and adds the quotes itself; `'$lat'` arrives as `''-0.9''` and fails to parse.

The panel renders the result as a polygon: `geom` is a recognised geometry column, and the WKB hex
is decoded for you.

## 5. Count what is inside (query C)

Add a **Stat** panel with the same ring CTE, and count the events inside it:

```sql
-- … the same params/pts/ring CTEs …
, circle AS (
  SELECT ST_GeomFromText(
    'POLYGON((' || string_agg(round(lng_deg, 5) || ' ' || round(lat_deg, 5), ',' ORDER BY deg) || '))'
  ) AS g FROM ring
)
SELECT count(*) AS events
FROM read_parquet('https://your-host/quakes.parquet'), circle
WHERE ST_Within(ST_Point(longitude_num, latitude_num), circle.g);
```

Regenerating the ring identically is what makes the number honest: the stat counts exactly what the
drawn circle encloses, rather than something approximately similar.

## 6. Fly the map from a table

One more mapping, the same variable pair read the **other** way:

| Field  | Value      |
| ------ | ---------- |
| Source | **Center** |
| Lat    | `lat`      |
| Lng    | `lng`      |
| Zoom   | `6`        |

Now add a **Table** panel of the largest events, with `latitude` and `longitude` as hidden columns
and a per-row data link:

```
?var-lat=${__data.fields.latitude}&var-lng=${__data.fields.longitude}
```

Click a row: the map flies to it, the circle redraws there, the stat recounts. A table has become a
map control.

Two behaviours keep this from becoming a loop: the map's **own** clicks are recognised and never
re-centre it, and on load the saved viewport wins — the pair moves the map only when someone else
changes it.

## What you learned

- A **Coordinates** mapping publishes the place, not a column value.
- The panel needs no spatial logic: the database draws the circle and the map renders it as data.
- `ST_Buffer` is the wrong tool for a real radius on a globe.
- Guard for the pre-click empty value with `try_cast` and a `WHERE`.
- **Center** reads the same pair backwards, which turns any panel into a map control.

## Next

[Tutorial 6 — A wind field](./wind-field), the one layer whose geometry the panel computes rather
than queries.
