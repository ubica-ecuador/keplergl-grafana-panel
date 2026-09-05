# Wind and other velocity fields

A query that returns a **regular grid of velocities** becomes a **Flow field** layer: an animated
field of streamlines, the paths a massless particle would take through the grid. Nothing to
configure to get one — give the panel coordinates and a velocity and the layer appears — and
everything to configure once you have it, in the layer's own panel inside the map.

```sql
SELECT ts AS "time", lat, lon, speed, direction
FROM wind_grid
WHERE level_hpa = 700
ORDER BY lat, lon;
```

<video src="/img/guide-velocity-fields.mp4" poster="/img/guide-velocity-fields.jpg" autoplay loop muted playsinline controls aria-label="A Flow field layer animating: streamlines traced through a grid of river velocities across South America, particles running along them" style="width:100%;height:auto;border-radius:8px"></video>

## This one is not a table of places

Every other layer draws your rows. This one does not. The rows describe a **grid of vectors**, and
what gets drawn are paths traced _through_ that grid — geometry the layer computes at draw time,
which your query never contained.

Your rows do reach the map: the dataset holds the lattice the query returned, columns and all, and
the layer is pointed at the ones that carry the velocity. What it draws is not in them.

That has a few consequences worth holding on to: the number of lines has nothing to do with the
number of rows, the lines are recomputed when you pan or zoom, and there is nothing to hover — a
streamline is not a row.

::: tip The dots are the grid
kepler also guesses a Point layer from the same coordinates. The panel removes it: those dots are
the lattice itself, honestly drawn and not what the query is about. Add one back from **Add Layer**
if you want to see where your samples are.
:::

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

::: tip The columns are the layer's, not the panel's
Autodetection only picks the layer's opening guess. The four velocity columns are chosen in the
layer's own **Columns** section, which also carries the switch between the two spellings — so a
query whose names are in neither list above needs no aliasing, just a different column picked.
:::

## What disqualifies a query

A **trip id** column. A GPS trace that happens to carry a `speed` column is a trajectory, not a
field, and shredding it into streamlines would draw lines that mean nothing. The rule is explicit:
coordinates, plus a velocity pair, and **no** trip id.

## The grid

::: warning The grid must really be regular
The axes are inferred, and the values have to lie on a regular lattice within 5% of the inferred
step. A source that snaps your requested coordinates to its own model grid — Open-Meteo does — will
break that: the inference fails, the field is never built, and you get **rows in the panel, an empty
map, and no error anywhere**.

Round the coordinates back to the lattice you asked for, and space that lattice wider than the
snapping error. See [Tutorial 6](../../tutorials/wind-field).
:::

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

The field is blurred before tracing, over a radius of **3 cells** by default — the same smoothing
Esri's own wind demo applies. At a 0.25° grid that is roughly 28 km per cell, so the blur averages
over about a synoptic feature: enough to stop the tracer jittering between adjacent cells, not
enough to erase anything a 25 km model actually resolves.

**Smoothing (cells)** under **Field** changes it. Zero traces the grid as it came, which on a coarse
lattice makes the lines visibly wobble between cells.

## The lines follow the view

::: tip Nothing is drawn until you press play
At the start of the animation window every trail has zero length. A paused field is a blank map —
press play on the timeline.
:::

Density and on-screen length hold steady as you zoom, because the field is **re-traced whenever the
map settles** — a fixed budget of lines per screen, each a fixed number of pixels long. Only the
share of the screen your data actually covers gets drawn.

The lines are seeded by picking points **on the screen** and asking the camera what ground is under
them, so a tilted or rotated map is covered to its edges. That matters more than it sounds: tilt the
camera and the ground on screen stops being a rectangle and becomes a trapezoid reaching towards the
horizon — measured at a pitch of 50°, two and a half times deeper up-range than the flat rectangle
is tall. A field seeded into the rectangle simply stops halfway up the screen.

Re-tracing reads the grid already in the browser, so panning costs no database work, and it does not
touch the dataset — the playhead keeps running through it.

## Density

**Lines per screen** under **Streamlines**: 9,000 by default, from 500 to 20,000, and per layer.
Stack three pressure levels and each asks for its own allowance, so lower them together if the
levels stop being tellable apart.

### What the budget is *for*

**Zoom response**, next to it, decides that — and it is what to reach for when zooming in does not
feel like zooming in.

At **0**, the default and what this drew before the knob existed, the budget is for the **screen**:
the same number of lines whether the screen shows the whole field or a corner of it, so the map
looks the same at every scale. That is Esri's model, and it is the right one for a map that is
looked at at one scale.

At **1** the budget is for the **field**: zooming in shows only the share of it that is on screen,
so the lines thin out and separate as you go in. Measured on the tutorial's grid, a map holding
3,100 lines zoomed out drops to 930 zoomed three levels in — the field opens up instead of staying
uniformly busy.

In between the two are blended, which is usually where a map that is read across several scales
wants to sit.

There is no figure that suits every map:

- A country covering a third of the view wants more lines than a pair of three-kilometre patches
  around two weather stations.
- A field of parallel arrows reads as a solid block at a density a swirling one reads well at.
- Zooming into a single station's patch fills the screen with what was a comfortable count across a
  country.

Lower it when the field looks matted; raise it when it looks sparse. For reference, Esri's own demo
spends 6,000 on a single field, so the default is deliberately generous.

## Several levels at once

One query per level, in the same panel. Each becomes its own layer.

To separate them in the vertical, give each layer a height and tilt the camera with the 3D control.
Two ways, and the layer takes the first that applies:

1. **A height column** — return one and bind it to the layer's optional `altitude` column. Its first
   value is the level's height; one query is one level, so it is read as a constant.
2. **Height (m), when no column** — under **Field**. For the ordinary case, where the height of a
   level is a property of the query rather than of its rows and there is no column to return.

Height is opt-in either way. Nothing autodetects an altitude: an `elevation` column picked up by
accident lifts a layer kilometres into the air, where it vanishes as soon as the camera descends
below it.

The exaggeration is computed for you, and it is not a fixed factor. Pressure levels a few kilometres
apart are invisible over a country hundreds of kilometres wide — 1000 to 700 hPa is 2.9 km over
about 650 km, four parts in a thousand — so the stack is scaled to a **share of the current view**
instead, about 15% of its width. It is derived from the **tallest level on the map**, not from each
layer's own height, so the levels keep their real proportions to each other and the stack occupies
the same share of the screen at every zoom.

**Vertical exaggeration** under **Field** multiplies that. Set it the same on every level, or they
stop being in proportion.

::: tip The two height knobs do different jobs
Because the exaggeration normalises the **tallest level on the map**, the metres of a *single* layer
decide only whether it sits on the ground or is lifted — not how high it is drawn. That is the
exaggeration's job.

The metres earn their keep with a second level: they are what puts 850 hPa and 700 hPa in their real
proportion to each other. One layer at 3,000 m and one at 500 m draw six times apart; one layer at
3,000 m on its own draws exactly where one at 500 m would.
:::

## Styling

Every knob is in the layer's own panel, grouped as **Colour**, **Streamlines**, **Animation** and
**Field**.

| Knob | Where | Does what |
| --- | --- | --- |
| Colour by speed | Colour | On, each line takes its colour from its mean speed through the ramp below. Off, the whole field is one colour. |
| Lines per screen | Streamlines | The density budget. |
| Zoom response | Streamlines | Whether that budget is for the screen (0) or for the whole field (1). |
| Stroke width | Streamlines | Line width in **pixels**, so it holds as you zoom. |
| Trail length | Streamlines | How much of the cycle the moving trail spans, as a percentage. |
| Line length | Streamlines | Vertices per streamline — how far a line reaches, not how much of it is lit. |
| Cycle | Animation | The length of the loop, in seconds. |
| Line lifetime | Animation | The share of the cycle one line lives for, and so how much of the field is lit at once. |
| Seamless loop | Animation | Carries a line whose life runs past the end of the cycle round to the start of it. On by default. |
| Smoothing | Field | Blur radius in cells. |
| Height (m) | Field | What this level *is*, when no altitude column is bound. Counts against the other levels. |
| Vertical exaggeration | Field | How tall the stack is drawn. The one that moves a lone layer. |

**Trail length** is the one that changes the character of the map most: short reads as drifting
particles, long as complete streamlines, closer to a classic wind chart. It is a *share of the
cycle* rather than an absolute number, so lengthening the cycle does not silently shorten every
trail.

Every line lives for a little over half the cycle by default, with births scattered through it, so
trails appear and fade continuously rather than the whole field restarting in unison.

::: warning Turning the seamless loop off brings back a visible wave
Without it a line has to end before the cycle does. Nothing is then born in the window's last
stretch and nothing has been alive long at its start, so the field **empties into the loop and
refills out of it** — measured on the map, the amount of line on screen swings by a factor of two
through the cycle, against 3% with it on.

What it costs is a second drawing of every line that crosses the seam: about half again as many
lines at the default lifetime, and nearly double at a lifetime of 1. That is the reason it can be
switched off at all — a very dense field on a modest machine.
:::

With the seamless loop on, **Line lifetime** says only how much of the field is lit at once: at 0.55
a little over half the lines are mid-flight at any instant, and at 1 all of them are. Raise it for a
fuller field, lower it for scattered particles. Either way the density holds steady through the
cycle.
