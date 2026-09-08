# Coming from another kepler.gl tool

kepler.gl maps get built in several places — kepler.gl's own demo app, Dekart, Foursquare Studio —
and they all emit the same `KeplerGlSchema` JSON. This panel accepts it, so a map you styled
somewhere else in that ecosystem can be brought across rather than rebuilt.

This page covers bringing one over, and the two conventions worth knowing before you do.

## Bringing a saved map across

**Map configuration → Import configuration**, and paste the JSON.

Both shapes are accepted: the bare `{ version, config }` saved config, and a full exported
`{ datasets, config, info }` map. From the second only the `config` half is kept — the data comes
from your own queries.

Configurations from **older kepler releases are migrated** by kepler's own schema on the way in.
That matters because exports carry whatever version the tool happened to be running — Dekart is
still on kepler 3.2.6. It is pinned by a characterisation test in this plugin's suite, so a
regression in kepler's migration path fails a build rather than someone's dashboard.

**What will need fixing afterwards:** a pasted configuration references datasets by id, and this
panel's ids come from your query `refId`s. Import it, re-point each layer at your dataset in
kepler's layer panel, then **Save current map**. After that it is stable.

## Columns are detected, not required

Some tools ask you to name your columns to suit the plugin. This one detects a wide set and lets
you override any of it per query, so an unrecognised column is a dropdown in **Field mapping**
rather than a query rewrite.

| What you want        | Columns detected                                                                        |
| -------------------- | --------------------------------------------------------------------------------------- |
| Points               | `latitude`, `longitude`, plus `lat`, `lon`, `lng`, `long`, `x`, `y`                     |
| Time                 | any column the data source typed as time, under any name                                |
| Whole-object GeoJSON | a `geojson_layer` column                                                                |
| Row-level GeoJSON    | a `geojson` column, plus `geom`, `geometry`, `the_geom`, `wkb_geometry`, `wkt`, `shape` |
| Raw PostGIS geometry | works as-is — WKB/EWKB hex is decoded for you, with no `ST_AsGeoJSON` needed            |

Anything the detector guesses wrong is reassigned by hand. See [Field roles](../reference/field-roles).

## The one to watch: trips

If you are used to a tool that connects points in row order and uses a `time` column as the
sequence, note the difference here: this panel groups by a **trip id** first, then orders within
each trip.

A query that produced one long polyline elsewhere will therefore produce _n_ separate animated
trajectories here — which is almost always what you actually wanted, but it is a visible change.
A trip id plus time plus a position **is** an animated Trip layer; there is no animation toggle to
find. If your table genuinely has no trip id, add a constant one:

```sql
SELECT 1 AS trip_id, lat AS latitude, lon AS longitude, ts AS time
FROM readings ORDER BY ts;
```

## Requirements

This plugin needs Grafana 12.0.10 or later, for [a specific reason](./install#requirements). If you
are on an older Grafana, it is not an option yet.
