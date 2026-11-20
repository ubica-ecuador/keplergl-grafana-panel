# Field roles

A **role** is the part a column plays. Roles are detected from the column's name — case-insensitively
and **exactly** — except for time, which is detected from its type.

There are **forty-six** roles. The Field mapping editor exposes **sixteen** of them; the other
thirty are autodetect-only and are marked below.

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
| Geohash         | ✅     | `geohash` — used only without a latitude and longitude; see [Places by geohash or by name](../guide/data/places-by-name)                                                                                        | not renamed |
| Place name      | ✅     | `lookup` — looked up in the query's gazetteer (**Drawing each query → Place names**), only without coordinates                                                                                                | not renamed |
| Origin lat      | ✅     | `origin_lat`, `origin_latitude`, `from_lat`, `start_lat`, `source_lat`, `pickup_lat`, `lat0`                                                                                                                    | `lat0`      |
| Origin lng      | ✅     | `origin_lon`, `origin_lng`, `origin_long`, `origin_longitude`, `from_lon`, `from_lng`, `start_lon`, `start_lng`, `source_lon`, `source_lng`, `pickup_lon`, `pickup_lng`, `lng0`, `lon0`                         | `lng0`      |
| Destination lat | ✅     | `dest_lat`, `dest_latitude`, `destination_lat`, `to_lat`, `end_lat`, `target_lat`, `dropoff_lat`, `lat1`                                                                                                        | `lat1`      |
| Destination lng | ✅     | `dest_lon`, `dest_lng`, `dest_long`, `dest_longitude`, `destination_lon`, `destination_lng`, `to_lon`, `to_lng`, `end_lon`, `end_lng`, `target_lon`, `target_lng`, `dropoff_lon`, `dropoff_lng`, `lng1`, `lon1` | `lng1`      |
| Count           | ✅     | `count`, `trips`, `weight`, `flow`, `total`, `volume`, on an origin–destination query only: anywhere else the column keeps its name (1.7.0 and earlier renamed it on any query) | `count`     |
| Rotation        | ✅     | `bearing`, `heading`, `course`, `cog`, `track`, `azimuth`, `orientation`                                                                                                                                        | not renamed |
| Magnitude       | ✅     | `magnitude`, `intensity`, `amplitude`                                                                                                                                                                           | not renamed |
| Origin H3       | ❌     | `origin_h3`, `source_h3`, `from_h3`, `h3_0`                                                                                                                                                                     | `source_h3` |
| Destination H3  | ❌     | `dest_h3`, `target_h3`, `to_h3`, `h3_1`                                                                                                                                                                         | `target_h3` |
| U component     | ❌     | `u`, `u10`, `u_wind`, `wind_u`, `ugrd`, `u_component`                                                                                                                                                           | not renamed |
| V component     | ❌     | `v`, `v10`, `v_wind`, `wind_v`, `vgrd`, `v_component`                                                                                                                                                           | not renamed |
| Speed           | ❌     | `wind_speed`, `windspeed`, `wind_speed_10m`, `speed`, `ws`                                                                                                                                                      | not renamed |
| Direction       | ❌     | `wind_direction`, `winddirection`, `wind_direction_10m`, `direction`, `wind_dir`, `wd`                                                                                                                          | not renamed |
| Raster URL      | ❌     | `raster_url`, `cog_url`, `cog`, `asset_href`, `href`                                                                                                                                                            | not renamed |
| Raster STAC item | ❌    | `raster_item_url`, `stac_item_url`, `item_url`                                                                                                                                                                  | not renamed |
| Raster ramp      | ❌    | `raster_colormap`, `raster_ramp` — this query's, over the **Raster colour ramp** option                                                                                                                         | not renamed |
| Raster bands     | ❌    | `raster_bands`, `band_combination` — this query's, over the **Raster bands** option                                                                                                                             | not renamed |
| Raster painted   | ❌    | `raster_painted` — true or false, over **Let the tile server paint**                                                                                                                                            | not renamed |
| WMS URL         | ❌     | `wms_url`, `wms`, `service_url`                                                                                                                                                                                 | not renamed |
| WMS layer       | ❌     | `wms_layer`, `layer`, `layer_name`                                                                                                                                                                              | not renamed |
| Box             | ❌     | `tiles_bbox`, `wms_bbox` — a WMS's or tiles' box, `west south east north`                                                                                                                                       | not renamed |
| Esri service    | ❌     | `esri_url`, `image_service_url`, `imageserver_url`                                                                                                                              | not renamed |
| Esri mosaic rule | ❌    | `esri_mosaic_rule`, `mosaic_rule`                                                                                                                                               | not renamed |
| Esri render rule | ❌    | `esri_rendering_rule`, `rendering_rule`                                                                                                                                         | not renamed |
| Tiles URL       | ❌     | `tiles_url`, `xyz_url` — a `{z}/{x}/{y}` template                                                                                                                                                               | not renamed |
| Tiles format    | ❌     | `tiles_format` — `raster`, `mvt` or `pmtiles`                                                                                                                                                                   | not renamed |
| Tiles min zoom  | ❌     | `tiles_min_zoom`                                                                                                                                                                                                | not renamed |
| Tiles max zoom  | ❌     | `tiles_max_zoom`                                                                                                                                                                                                | not renamed |
| Tiles zoom ids  | ❌     | `tiles_zoom_ids` — `z:name` pairs, comma separated                                                                                                                                                              | not renamed |
| Zarr URL        | ❌     | `zarr_url`, `zarr`, `store_url`                                                                                                                                                                                 | not renamed |
| Zarr variable   | ❌     | `zarr_variable`, `zarr_var`                                                                                                                                                                                     | not renamed |
| Zarr time label | ❌     | `zarr_time_label`, `zarr_label`                                                                                                                                                                                 | not renamed |
| Zarr levels     | ❌     | `zarr_levels`, `zarr_pyramid`                                                                                                                                                                                   | not renamed |
| Zarr selectors  | ❌     | `zarr_sel`, `zarr_select`                                                                                                                                                                                       | not renamed |
| Zarr time axis  | ❌     | `zarr_time_dim`, `zarr_dim`                                                                                                                                                                                     | not renamed |
| Zarr ramp       | ❌     | `zarr_colormap`, `zarr_ramp`                                                                                                                                                                                    | not renamed |
| Zarr range      | ❌     | `zarr_rescale`, `zarr_range`                                                                                                                                                                                    | not renamed |

::: warning Some roles cannot be mapped by hand
The editor offers the sixteen roles a table of rows needs. The other twenty-four — `originH3`,
`destH3`, `u`, `v`, `speed`, `direction`, the box, and every `raster*`, `wms*`, `esri*`, `tiles*`
and `zarr*` role —
are detected but have no entry in it. If your columns are named something the lists do not cover,
**alias them in the query**:

```sql
SELECT h3_pickup AS origin_h3, h3_drop AS dest_h3, COUNT(*) AS trips
FROM journeys GROUP BY 1, 2;
```

The four velocity roles are never renamed, because the Streamlines layer is pointed at whatever the
query called them — and once the layer exists, they can be re-pointed from its own **Columns**
section. Streamlines' third spelling, [the gradient of a
value](../guide/data/velocity-fields#the-gradient-of-a-value), has no role at all and is not
detected: any numeric column could be a scalar field, so that one is chosen on the layer or not at
all. The raster, WMS, Esri and tiles roles are not renamed either, for a different reason: each
becomes a dataset of its own.
:::

## The WMS roles make a second dataset too

`wmsUrl` and `wmsLayer` work the same way as `rasterUrl`, and go together: a service publishes many
layers, so a URL without a layer name is not a picture. Both must be present or neither role
applies.

A query that carries them produces the ordinary row dataset plus a WMS dataset, id
`grafana-<refId>-wms`, which holds no rows — only where the service is and which of its layers to
draw. There is no tile server in that list, and its absence is the point: a WMS renders its own
imagery, so nothing sits in between.

The box (`tiles_bbox`) is optional: the layer's box as text, `west south east north` in degrees,
from the same row. The map frames the layer on it when the view shows none of it, and draws the service's picture
only inside it. See [WMS services](../guide/data/wms#where-the-layer-is).

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

## The tile roles

A query whose row has a `tiles_url` names map tiles: a `{z}/{x}/{y}` template (`{-y}` counts rows
from the south, `{s}` takes the first subdomain), as the Spatial Catalog's Services frame gives any
map service that is not a WMS. The panel makes an XYZ tile dataset of it, id `grafana-<refId>-tiles`,
from the first row with an address, beside the ordinary row dataset; like a WMS, it needs no tile
server and is rebuilt from the query on every load, never saved with the map.

- `tiles_format`: `raster` is drawn. `mvt` (vector tiles) and `pmtiles` are not drawn yet. Without
  the column, an address ending in `.pmtiles` is an archive, one in `.mvt` or `.pbf` vector tiles, and
  anything else pictures.
- `tiles_min_zoom`, `tiles_max_zoom`: the levels the service has; past the last one its tiles are
  stretched.
- `tiles_zoom_ids`: the service's own name for a level where it is not the number, as `z:name` pairs
  (`0:00,1:01,…`: PDOK's WMTS names its matrices "00" to "19"). `{z}` becomes the name.
- `tiles_bbox`: the box, framed on and cut to as a WMS's is; no tile outside it is asked for.

`tiles_metadata_url` (a TileJSON or the archive) is not read yet.

**One service per query.** The first row that names a service decides what the query draws, and in
that row a WMS (`wms_url` with `wms_layer`) wins over an Esri service (`esri_url`), which wins over
tiles (`tiles_url`), which win over a raster (`raster_url`). A Zarr store is drawn as before.

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
| Symbols           | latitude **and** longitude **and** a numeric bearing    |

When a flow query carries both an H3 pair and a coordinate pair, **H3 wins** — a hexagon flow is the
more specific description.

A velocity query additionally requires **no trip id**: a GPS trace carrying a `speed` column is a
trajectory, not a field. So does a symbol query, for the same reason — a trajectory is a path, not a
scattering of marks.

## Rotation and magnitude are not the wind roles

`rotation` and `magnitude` name *anything* that points and anything that measures: a vehicle, a
vessel, an aircraft. `direction` and `speed` name a **wind**, and carry the meteorological
convention with them — a direction of 90° is a wind *from* the east. A wind direction also builds
symbols, read that way round; a `bearing` or a `heading` is read as the course the thing is on. See
[Symbols](../guide/data/symbols#which-way-the-bearing-is-read).

Two details are worth knowing:

- **A bearing must be numeric to count.** `track`, `course`, `heading` and `cog` are as likely to
  name a label or a URL as a number of degrees, so a non-numeric one is set aside rather than used.
- **`cog` is the one name two roles share on purpose** — course over ground, and cloud-optimised
  GeoTIFF. The two readings exclude each other by type: the raster reader ignores values that are
  not strings, and a symbol layer is built only from a numeric bearing.

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
