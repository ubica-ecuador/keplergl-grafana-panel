# Field roles

A **role** is the part a column plays. Roles are detected from the column's name — case-insensitively
and **exactly** — except for time, which is detected from its type.

There are **twenty-one** roles. The Field mapping editor exposes **twelve** of them; the other nine
are autodetect-only and are marked below.

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
| Raster URL      | ❌     | `raster_url`, `cog_url`, `cog`, `asset_href`, `href`                                                                                                                                                            | not renamed |
| WMS URL         | ❌     | `wms_url`, `wms`, `service_url`                                                                                                                                                                                 | not renamed |
| WMS layer       | ❌     | `wms_layer`, `layer`, `layer_name`                                                                                                                                                                              | not renamed |
| Esri service    | ❌     | `esri_url`, `image_service_url`, `imageserver_url`                                                                                                                              | not renamed |
| Esri mosaic rule | ❌    | `esri_mosaic_rule`, `mosaic_rule`                                                                                                                                               | not renamed |
| Esri render rule | ❌    | `esri_rendering_rule`, `rendering_rule`                                                                                                                                         | not renamed |
| Zarr URL        | ❌     | `zarr_url`, `zarr`, `store_url`                                                                                                                                                                                 | not renamed |
| Zarr variable   | ❌     | `zarr_variable`, `zarr_var`                                                                                                                                                                                     | not renamed |
| Zarr time label | ❌     | `zarr_time_label`, `zarr_label`                                                                                                                                                                                 | not renamed |
| Zarr levels     | ❌     | `zarr_levels`, `zarr_pyramid`                                                                                                                                                                                   | not renamed |
| Zarr selectors  | ❌     | `zarr_sel`, `zarr_select`                                                                                                                                                                                       | not renamed |
| Zarr time axis  | ❌     | `zarr_time_dim`, `zarr_dim`                                                                                                                                                                                     | not renamed |

::: warning Nine roles cannot be mapped by hand
`originH3`, `destH3`, `u`, `v`, `speed`, `direction`, `rasterUrl`, `wmsUrl` and `wmsLayer` are
detected but have no entry in the Field mapping editor. If your columns are named something the lists do not cover, **alias them
in the query**:

```sql
SELECT h3_pickup AS origin_h3, h3_drop AS dest_h3, COUNT(*) AS trips
FROM journeys GROUP BY 1, 2;
```

The four velocity roles are never renamed, because the flow field layer is pointed at whatever the
query called them — and once the layer exists, they can be re-pointed from its own **Columns**
section. The raster and WMS roles are not renamed either, for a different reason: each becomes a
dataset of its own.
:::

## The WMS roles make a second dataset too

`wmsUrl` and `wmsLayer` work the same way as `rasterUrl`, and go together: a service publishes many
layers, so a URL without a layer name is not a picture. Both must be present or neither role
applies.

A query that carries them produces the ordinary row dataset plus a WMS dataset, id
`grafana-<refId>-wms`, which holds no rows — only where the service is and which of its layers to
draw. There is no tile server in that list, and its absence is the point: a WMS renders its own
imagery, so nothing sits in between.

Give the **bare endpoint**. A whole `GetMap` URL is trimmed back to it, because every request is
built by appending parameters to what you give and a query string already there would corrupt the
first of them.

If the query also carries a **time column**, those dates become the timeline. If it does not, the
panel reads the layer's own `<Dimension name="time">` from the service's `GetCapabilities` and uses
that — which is the version that stays correct as the server gains new passes. Either way the
calendar arrives as a third dataset, `grafana-<refId>-wms-times`, one row per date: kepler's time
filter is always a filter on a column, so the dates have to be on the map for the widget to exist.

Moving the widget re-asks the service for that date and nothing else. See
[WMS services](../guide/data/wms) and [Imagery over time](../guide/data/imagery-over-time).

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

## The raster role makes a second dataset

`rasterUrl` behaves unlike every other role. The others describe _where a row is_; this one says the
query is not really about rows at all — it points at an image somewhere in a bucket.

A query that carries one produces **two** datasets:

- the ordinary row dataset, with whatever columns the query returned: scene id, date, cloud cover.
  Useful in a table beside the map, and drawn as a layer if it also carries coordinates;
- a raster dataset, id `grafana-<refId>-raster`, holding no rows at all — only the link to the
  imagery and the tile server that can read it. kepler draws it with its Raster Tile layer.

One scene is drawn at a time — a table of ten describes a choice still to be made, not ten layers
to stack. Which one depends on what the query returned:

- **One row**, or several with no time column: the first row. This is the ordinary case, and what
  `ORDER BY … LIMIT 1` in SQL gives you.
- **Several dated rows**: the map's time widget decides. One row per pass of the satellite makes the
  query a small catalogue, the timeline shows a bar per capture, and the map draws the most recent
  one inside the window you select. The whole series is already in the browser, so dragging costs no
  query at all — and a window that contains no capture draws nothing, which is the honest answer.

Drawing it needs a tile server, which is the [Raster tile server](./panel-options.md) panel option —
unless the URL names a `.pmtiles` archive, which kepler reads by itself. See
[Satellite imagery and other rasters](../guide/data/rasters) and
[Imagery over time](../guide/data/imagery-over-time).
