# How a query becomes a map

The panel does not ask you to describe your data. It reads the columns your query already returned,
works out what part each one plays, and builds the layer. This page is the whole pipeline in one
place; the pages after it go role by role.

## The pipeline

<svg viewBox="0 0 720 132" role="img" aria-label="Pipeline: query results, field-role detection, kepler dataset, layer" style="max-width:100%;height:auto;color:var(--vp-c-text-1)">
  <g fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55">
    <rect x="4" y="34" width="150" height="52" rx="6"/>
    <rect x="190" y="34" width="150" height="52" rx="6"/>
    <rect x="376" y="34" width="150" height="52" rx="6"/>
    <rect x="562" y="34" width="150" height="52" rx="6"/>
    <path d="M158 60h26m2 0-8-4v8zM344 60h26m2 0-8-4v8zM530 60h26m2 0-8-4v8z"/>
  </g>
  <g fill="currentColor" font-family="system-ui,sans-serif" font-size="12.5" text-anchor="middle">
    <text x="79" y="55">One data frame</text>
    <text x="265" y="55">Field roles</text>
    <text x="451" y="55">kepler dataset</text>
    <text x="637" y="55">Layer</text>
  </g>
  <g fill="currentColor" font-family="system-ui,sans-serif" font-size="10.5" text-anchor="middle" opacity="0.65">
    <text x="79" y="72">per query</text>
    <text x="265" y="72">detected, then yours</text>
    <text x="451" y="72">columns renamed</text>
    <text x="637" y="72">kepler's, or ours</text>
  </g>
  <g fill="currentColor" font-family="system-ui,sans-serif" font-size="11" text-anchor="middle" opacity="0.6">
    <text x="79" y="112">refId A, B, C…</text>
    <text x="265" y="112">latitude, time, tripId…</text>
    <text x="451" y="112">latitude, time, trip_id…</text>
    <text x="637" y="112">point, trip, flow…</text>
  </g>
</svg>

### One query, one dataset

Each query in the panel becomes **one kepler dataset**, identified by its Grafana `refId`. A panel
with queries A, B and C gives you three datasets you can style, filter and reorder independently —
which is how you overlay a road network on a heatmap on a set of trajectories in a single map.

That id is derived from the `refId` rather than generated, and the stability matters: it is what
lets a refresh **replace the rows underneath a dataset** while leaving the layers you configured
sitting on top of them. Most panels of this kind tear the dataset down and rebuild it on every
refresh, which throws your styling away each time the query re-runs.

### Detection, then your overrides

Roles are guessed twice over. First by **column name**, matched case-insensitively and _exactly_:

| Role        | Detected from                                                                           |
| ----------- | --------------------------------------------------------------------------------------- |
| `latitude`  | `latitude`, `lat`, `y`                                                                  |
| `longitude` | `longitude`, `lon`, `lng`, `long`, `x`                                                  |
| `tripId`    | `trip_id`, `tripid`, `track_id`, `trackid`, `trajectory_id`, `vehicle_id`, `journey_id` |
| `geometry`  | `geom`, `geometry`, `the_geom`, `wkb_geometry`, `geojson`, `wkt`, `shape`               |
| `h3`        | `h3`, `h3_index`, `hex_id`, `hexagon`, `h3index`                                        |

The exact match is deliberate. Substring matching would let `origin_lat` satisfy `lat`, and an
origin–destination table would silently collapse into a plain point layer. The full table for all
twenty-one roles is in [Field roles](../../reference/field-roles).

**Time is the exception**: it is found by _type_, not by name. Grafana already knows which column is
temporal, and real dashboards call it everything from `time` to `recorded_at` to `__timestamp`.

Then your overrides are applied, per query, from **Field mapping** in the panel options. A role can
be in one of three states — and the third one is why the editor has a **None** entry:

| State               | How            | Effect                                   |
| ------------------- | -------------- | ---------------------------------------- |
| Autodetected        | leave it alone | the guess stands, shown as a placeholder |
| Pointed at a column | pick a column  | your choice wins                         |
| Switched off        | pick **None**  | the role is removed entirely             |

Switching a role off is a real answer, not the absence of one. It is the only way to draw a query
carrying a `vehicle_id` as loose points rather than as trajectories — clearing the field would just
hand the role back to autodetection, which would find `vehicle_id` again.

### Columns are renamed, not configured

kepler builds its own default layers by looking at column names. So a role is expressed by
**renaming your column** on the way in, rather than by writing a layer configuration:

| Role                       | Your column, renamed to        |
| -------------------------- | ------------------------------ |
| `latitude` / `longitude`   | `latitude` / `longitude`       |
| `time`                     | `time`                         |
| `tripId`                   | `trip_id`                      |
| `altitude`                 | `altitude`                     |
| `geometry`                 | `_geojson`                     |
| `h3`                       | `h3`                           |
| origin/destination lat/lng | `lat0`, `lng0`, `lat1`, `lng1` |
| origin/destination H3      | `source_h3`, `target_h3`       |
| `count`                    | `count`                        |

**Every other column is passed through untouched**, which is what keeps it available for tooltips,
colour scales and filters. Nothing is dropped for not having a role.

### Who builds the layer

kepler auto-detects some layers from those column names and not others, so the panel fills the gaps:

| Layer              | Built by      | Why                                                                  |
| ------------------ | ------------- | -------------------------------------------------------------------- |
| Point              | kepler        | it recognises `latitude`/`longitude`                                 |
| GeoJSON / polygon  | kepler        | it recognises `_geojson`                                             |
| H3, S2             | kepler        | it recognises the index columns                                      |
| **Trip**           | **the panel** | kepler's own trip heuristic insists on a column literally named `id` |
| **Flow**           | **the panel** | kepler does not auto-detect flows at all                             |
| **Velocity field** | **the panel** | the rows are a grid, not places — see below                          |

## The two layers the panel builds from scratch

A **trajectory** query — one with a trip id, a time and a position — gets a Trip layer emitted
explicitly, in kepler's saved-config shape so kepler parses it as a configuration rather than
trying to use it verbatim. See [Trajectories](./trajectories).

An **origin–destination** query gets a Flow layer the same way, in `LAT_LNG` or `H3` column mode.
H3 wins when both are present, on the grounds that a hexagon flow is the more specific description.
See [Origin–destination flows](./flows).

## The one query that is not a table of places

A **velocity field** is different in kind. Its rows describe a grid of vectors, and what gets drawn
is not the rows but the paths traced _through_ them. The panel consumes the grid, smooths it, traces
streamlines, and hands kepler their geometry — so kepler detects a Trip layer from `_geojson` and
never sees your `u`/`v` or `speed`/`direction` columns at all. See
[Wind and other velocity fields](./velocity-fields).

A query qualifies when it has coordinates and a velocity **and no trip id**. That last condition
is load-bearing: a GPS trace that happens to carry a `speed` column is a trajectory, and shredding
it into streamlines would draw lines that mean nothing.

## The query that returns an address instead of rows

There is a second departure from the pipeline, and it goes the other way. A column named
`raster_url` — or a `wms_url` and `wms_layer` pair — does not describe where a row is. It says the
query is not really about rows at all: the thing to draw is an image, and what the query can
contribute is **where to find it**.

Those queries produce a **second dataset with no rows** alongside the ordinary one, holding only
the address and, for a raster, the server that can read it. Your rows are still a dataset — a
catalogue search returns a scene id, a date and a cloud cover worth keeping — so nothing is lost
by one of its columns being an image.

Return one row per date and the map's time widget walks them, which is the whole of the
multitemporal arrangement. See [Rasters](./rasters), [WMS services](./wms) and
[Imagery over time](./imagery-over-time).

## What survives a refresh

Datasets kepler already holds have their rows swapped in place; only a genuinely new query — one
that gained a `refId` — creates a dataset. Your layers, colours, filters and interactions are
untouched by a refresh.

They are not, however, saved anywhere by default. Layer styling lives in kepler's store, not
Grafana's, so it survives a refresh but not a page reload until you capture it explicitly with
**Map configuration → Save current map**. See [Map configuration](../map/map-configuration).
