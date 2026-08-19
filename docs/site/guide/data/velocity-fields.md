# Wind and other velocity fields

A query that returns a **regular grid of velocities** becomes an animated field of streamlines — the
paths a massless particle would take through it. Nothing to configure: give the panel coordinates
and a velocity and it builds the field, smooths it, traces the lines and hands them to kepler's own
Trip layer.

```sql
SELECT ts AS "time", lat, lon, speed, direction
FROM wind_grid
WHERE level_hpa = 700
ORDER BY lat, lon;
```

## This one is not a table of places

Every other layer draws your rows. This one does not. The rows describe a **grid of vectors**, and
what gets drawn are paths traced _through_ that grid — geometry the panel computes, which your
query never contained. kepler receives those paths as a `_geojson` column and builds a Trip layer
from them; it never sees your `speed` or `u` columns at all.

That has a few consequences worth holding on to: the number of lines has nothing to do with the
number of rows, the lines are recomputed when you pan or zoom, and a tooltip on a line shows the
line's properties rather than a row of your table.

## Two ways to give velocity

Both pairs are all-or-nothing — half of one describes nothing.

### Speed and direction

What most sources give you: Open-Meteo, GFS, national weather services.

| Role      | Detected from                                                                          |
| --------- | -------------------------------------------------------------------------------------- |
| Speed     | `wind_speed`, `windspeed`, `wind_speed_10m`, `speed`, `ws`                             |
| Direction | `wind_direction`, `winddirection`, `wind_direction_10m`, `direction`, `wind_dir`, `wd` |

`direction` is read as the **meteorological convention**: the bearing the wind blows _from_. A
direction of 270° is a westerly — air moving towards the east. If your source uses the
oceanographic convention (the direction of travel), add 180 in the query.

### U and V components

| Role          | Detected from                                         |
| ------------- | ----------------------------------------------------- |
| U (eastward)  | `u`, `u10`, `u_wind`, `wind_u`, `ugrd`, `u_component` |
| V (northward) | `v`, `v10`, `v_wind`, `wind_v`, `vgrd`, `v_component` |

`ugrd` and `vgrd` are the GRIB2 short names GFS ships, so a table converted straight from a GRIB
file needs no renaming at all.

::: warning These four roles are autodetect-only
None of `u`, `v`, `speed` or `direction` appears in the Field mapping editor. Alias them in the
query if your names are not in the lists above.
:::

## What disqualifies a query

A **trip id** column. A GPS trace that happens to carry a `speed` column is a trajectory, not a
field, and shredding it into streamlines would draw lines that mean nothing. The rule is explicit:
coordinates, plus a velocity pair, and **no** trip id.

## The grid

Rows are cells. The grid itself is **inferred**, so the query may return them in any order —
`ORDER BY lat, lon` is for your own benefit when you inspect the rows, not the panel's.

When the query spans several timesteps the **earliest** is used. Select a single one to be explicit
rather than relying on that.

### Holes are holes, not calm air

Cells the query omits are treated as **absent**, and streamlines stop at their edge. This is the
mechanism for excluding a pressure level that runs below ground: omit those cells and the lines end
at the mountains, instead of drawing weather through rock.

```sql
SELECT ts AS "time", lat, lon, speed, direction
FROM wind_grid
WHERE level_hpa = 700
  AND surface_pressure_hpa >= 700   -- drop cells where this level is underground
```

### Smoothing

The field is blurred over a **3-cell radius** before tracing, once, when the data arrives — the
same smoothing Esri's own wind demo applies. At a 0.25° grid that is roughly 28 km per cell, so the
blur averages over about a synoptic feature: enough to stop the tracer jittering between adjacent
cells, not enough to erase anything a 25 km model actually resolves.

## The lines follow the view

Density and on-screen length hold steady as you zoom, because the field is **re-traced whenever the
map settles** — a fixed budget of lines per screen, each a fixed number of pixels long. Only the
share of the screen your data actually covers gets drawn.

Re-tracing uses the stored field rather than re-reading the query, so panning costs no database
work. The animation clock travels with it, so a re-trace does not jump the playhead.

## Wind line density

The budget is **9,000 lines per full screen by default**, adjustable from 500 to 20,000, and it is
**shared between the velocity-field layers on the same map**. Three pressure levels in one panel get
3,000 each — not 9,000 each, which would put three times the line count into the same pixels and
make the levels impossible to tell apart.

There is no figure that suits every map:

- A country covering a third of the view wants more lines than a pair of three-kilometre patches
  around two weather stations.
- A field of parallel arrows reads as a solid block at a density a swirling one reads well at.
- Zooming into a single station's patch fills the screen with what was a comfortable count across a
  country.

Lower it when the field looks matted; raise it when it looks sparse. For reference, Esri's own demo
spends 6,000 on a single field, so the default is deliberately generous — at 2,000 per level the
field read as sparse in testing.

## Several levels at once

One query per level, in the same panel. Each becomes its own layer.

To separate them in the vertical, return a height column and map it to **Altitude** under Field
mapping, then tilt the camera with the 3D control. Height is opt-in on purpose: an `elevation`
column mapped by accident lifts a layer kilometres into the air.

The exaggeration is computed for you, and it is not a fixed factor. Pressure levels a few kilometres
apart are invisible over a country hundreds of kilometres wide — 1000 to 700 hPa is 2.9 km over
about 650 km, four parts in a thousand — so the stack is scaled to a **share of the current view**
instead, about 15% of its width. One factor is used for the whole stack, so the levels keep their
real proportions to each other, and the stack occupies the same share of the screen at every zoom.

## Styling

Colour, width and **Trail Length** live in kepler's own layer settings, because these are Trip
layers underneath.

Trail length is the one that changes the character of the map most. Short reads as drifting
particles; long reads as complete streamlines, closer to a classic wind chart. Every line carries
its mean `speed`, so **Color Based On → speed** works.

The animation runs on a 60-second loop in which each line lives for a little over half the cycle,
with staggered births — so trails appear and fade continuously, rather than the whole field
restarting in unison every time the loop comes round.
