# Field roles

A **role** is the part a column plays. Roles are detected from the column's name — case-insensitively
and **exactly** — except for time, which is detected from its type.

There are **eighteen** roles. The Field mapping editor exposes **twelve** of them; the other six are
autodetect-only and are marked below.

## The full table

| Role            | Editor | Detected from                                                                                                                                                                                                   | Renamed to  |
| --------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Latitude        | ✅     | `latitude`, `lat`, `y`                                                                                                                                                                                          | `latitude`  |
| Longitude       | ✅     | `longitude`, `lon`, `lng`, `long`, `x`                                                                                                                                                                          | `longitude` |
| Time            | ✅     | **any column typed as time**                                                                                                                                                                                    | `time`      |
| Trip ID         | ✅     | `trip_id`, `tripid`, `track_id`, `trackid`, `trajectory_id`, `vehicle_id`, `journey_id`                                                                                                                         | `trip_id`   |
| Altitude        | ✅     | **nothing** — opt-in only                                                                                                                                                                                       | `altitude`  |
| Geometry        | ✅     | `geom`, `geometry`, `the_geom`, `wkb_geometry`, `geojson`, `wkt`, `shape`                                                                                                                                       | `_geojson`  |
| H3 index        | ✅     | `h3`, `h3_index`, `hex_id`, `hexagon`, `h3index`                                                                                                                                                                | `h3`        |
| Origin lat      | ✅     | `origin_lat`, `origin_latitude`, `from_lat`, `start_lat`, `source_lat`, `pickup_lat`, `lat0`                                                                                                                    | `lat0`      |
| Origin lng      | ✅     | `origin_lon`, `origin_lng`, `origin_long`, `origin_longitude`, `from_lon`, `from_lng`, `start_lon`, `start_lng`, `source_lon`, `source_lng`, `pickup_lon`, `pickup_lng`, `lng0`, `lon0`                         | `lng0`      |
| Destination lat | ✅     | `dest_lat`, `dest_latitude`, `destination_lat`, `to_lat`, `end_lat`, `target_lat`, `dropoff_lat`, `lat1`                                                                                                        | `lat1`      |
| Destination lng | ✅     | `dest_lon`, `dest_lng`, `dest_long`, `dest_longitude`, `destination_lon`, `destination_lng`, `to_lon`, `to_lng`, `end_lon`, `end_lng`, `target_lon`, `target_lng`, `dropoff_lon`, `dropoff_lng`, `lng1`, `lon1` | `lng1`      |
| Count           | ✅     | `count`, `trips`, `magnitude`, `weight`, `flow`, `total`, `volume`                                                                                                                                              | `count`     |
| Origin H3       | ❌     | `origin_h3`, `source_h3`, `from_h3`, `h3_0`                                                                                                                                                                     | `source_h3` |
| Destination H3  | ❌     | `dest_h3`, `target_h3`, `to_h3`, `h3_1`                                                                                                                                                                         | `target_h3` |
| U component     | ❌     | `u`, `u10`, `u_wind`, `wind_u`, `ugrd`, `u_component`                                                                                                                                                           | not renamed |
| V component     | ❌     | `v`, `v10`, `v_wind`, `wind_v`, `vgrd`, `v_component`                                                                                                                                                           | not renamed |
| Speed           | ❌     | `wind_speed`, `windspeed`, `wind_speed_10m`, `speed`, `ws`                                                                                                                                                      | not renamed |
| Direction       | ❌     | `wind_direction`, `winddirection`, `wind_direction_10m`, `direction`, `wind_dir`, `wd`                                                                                                                          | not renamed |

::: warning Six roles cannot be mapped by hand
`originH3`, `destH3`, `u`, `v`, `speed` and `direction` are detected but have no entry in the Field
mapping editor. If your columns are named something the lists do not cover, **alias them in the
query**:

```sql
SELECT h3_pickup AS origin_h3, h3_drop AS dest_h3, COUNT(*) AS trips
FROM journeys GROUP BY 1, 2;
```

The four velocity roles are never renamed for kepler in any case, because a velocity field is
consumed to trace streamlines and never reaches kepler as columns at all.
:::

## Why the match is exact

Substring matching would let `origin_lat` satisfy `lat`, which would silently turn an
origin–destination table into a plain point layer. The exactness is what keeps the roles from
stealing each other's columns.

The price is that an unusual name is simply not found — which is what the editor, and aliasing, are
for.

## Time is detected by type

Grafana already knows which column is temporal, and dashboards name it `time`, `recorded_at`,
`ts`, `__timestamp` or anything else. The first field the data source typed as time takes the role.

If your timestamps arrive as integers or strings, cast them in the query so the data source types
them properly.

## Altitude has no candidates, on purpose

GPS traces routinely carry an `elevation` column of metres above sea level, and deck.gl reads a
path's third coordinate as **height above the ground**. A trail through Cuenca at 2,650 m would be
drawn 2.65 km up: fine zoomed out, gone the moment the camera descends below it, at roughly zoom 15.

A layer that looks correct and then vanishes as you zoom in reads as a rendering bug, not as a
mapping choice — so height is opt-in through the editor.

## Three states, not two

| State        | How           | Effect                                   |
| ------------ | ------------- | ---------------------------------------- |
| Autodetected | leave it      | the guess stands, shown as a placeholder |
| Overridden   | pick a column | your choice wins                         |
| **Off**      | pick **None** | the role is removed entirely             |

The third state is why the editor has a **None** entry rather than just an empty field. Clearing the
field hands the role back to autodetection, which would find the same column again. `None` is the
only way to draw a trajectory table as loose points.

## All-or-nothing groups

Some roles mean nothing on their own:

| Group             | Needs                                                   |
| ----------------- | ------------------------------------------------------- |
| Point             | latitude **and** longitude                              |
| Trip              | trip id **and** time **and** latitude **and** longitude |
| Flow, coordinates | all four of origin/destination lat/lng                  |
| Flow, H3          | both origin and destination H3                          |
| Velocity          | `u` **and** `v`, **or** `speed` **and** `direction`     |

When a flow query carries both an H3 pair and a coordinate pair, **H3 wins** — a hexagon flow is the
more specific description.

A velocity query additionally requires **no trip id**: a GPS trace carrying a `speed` column is a
trajectory, not a field.

## Columns without a role

Passed through untouched, under their original names, and available for colour scales, radius,
filters and tooltips. Nothing is dropped for not having a role.
