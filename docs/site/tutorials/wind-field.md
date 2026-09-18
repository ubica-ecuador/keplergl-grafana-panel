# Tutorial 6 — A wind field

Live forecast wind over the southern Ecuadorian Andes, as an animated field of streamlines. About
twenty minutes.

**You need:** the [DuckDB data source](../guide/sources/duckdb-geoparquet). Not Infinity — and the
reason why is the most useful thing on this page.

## What makes this one different

Every other layer draws your rows. This one does not: the rows describe a **grid of vectors**, and
what gets drawn are the paths a massless particle would take through it — geometry the panel
computes and your query never contained.

So the number of lines has nothing to do with the number of rows, and the lines are re-traced
whenever you pan or zoom.

## The grid has to actually be a grid

::: danger This is the trap
[Open-Meteo](https://open-meteo.com/) takes a list of coordinates and returns one object per
location — but it **snaps each one to its own model grid**, and not consistently. Ask for a clean
7 × 7 lattice at 0.1° spacing and you get back **11 distinct latitudes and 46 distinct longitudes**
across 49 points.

The panel infers the grid from the rows, and requires the values to lie on a regular lattice within
5% of the step. A snapped scatter fails that test, `buildWindField` returns nothing, and you get a
panel with rows in it and an empty map — **no error anywhere**.
:::

Two things fix it, and you need both:

1. **Round the coordinates back** to the lattice you asked for.
2. **Space the grid wider than the snapping error.** At 0.1° the snap can exceed half a step, so two
   requested points round to the same cell and a third to a neighbour you never asked for. At
   **0.25°** it does not.

Rounding needs arithmetic on the response, which is why this tutorial uses DuckDB — it reads the
JSON _and_ does the maths. Infinity can fetch this API perfectly well, but it cannot round.

## 1. Build the URL

The two coordinate lists are **parallel and positional**: the *n*th latitude pairs with the *n*th
longitude, so every combination has to be enumerated. Generate them:

```python
lats = [-3.5 + 0.25 * i for i in range(7)]
lons = [-79.75 + 0.25 * j for j in range(7)]
pairs = [(round(a, 2), round(b, 2)) for a in lats for b in lons]
print(",".join(str(a) for a, _ in pairs))
print(",".join(str(b) for _, b in pairs))
```

Forty-nine points, a 650-character URL. The grid does not need to be dense — the panel smooths and
interpolates it — and a larger one costs URL length and API quota for little visible gain.

## 2. Create the panel

New dashboard → **Add visualisation** → DuckDB → **Kepler Geospatial Maps**.

The data source's **Init SQL** needs `httpfs` to read a URL:

```sql
INSTALL httpfs; LOAD httpfs;
```

## 3. The query

```sql
SELECT round(latitude  * 4) / 4 AS latitude,
       round(longitude * 4) / 4 AS longitude,
       hourly.wind_speed_10m[1]     AS speed,
       hourly.wind_direction_10m[1] AS direction
FROM read_json_auto('https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&hourly=wind_speed_10m,wind_direction_10m&forecast_days=1');
```

Paste your generated coordinate lists into the URL.

`round(x * 4) / 4` snaps to quarter degrees — the lattice you asked for. `read_json_auto` gives you
the response as rows with nested structs, so `hourly.wind_speed_10m[1]` is the first hour of the
forecast at that point. DuckDB arrays are **1-indexed**.

Run it. Forty-nine rows, and — the thing worth checking — **seven distinct latitudes and seven
distinct longitudes**. If you see more, your rounding does not match your spacing.

## 4. What happened

Four things triggered the field: coordinates, a **speed**, a **direction**, and — just as
importantly — **no trip id**. A GPS trace that happens to carry a `speed` column is a trajectory,
not a field, and shredding it into streamlines would draw lines that mean nothing. So a trip id is
disqualifying.

`direction` is read as the **meteorological convention**: the bearing the wind blows _from_. 270° is
a westerly, air moving east. If your source gives the direction of travel instead, leave the query
as it is and set **Field → Direction is** to **Where it goes** in the layer's panel.

::: tip u/v components work too
`u` and `v` are recognised, including the GRIB2 short names `ugrd` and `vgrd`, so a table converted
straight from a GFS file needs no renaming. Both pairs are all-or-nothing: half of one describes
nothing.
:::

## 5. Watch it

The field is already moving: it animates on a clock of its own, sixty seconds to the loop, and
nobody has to press anything. The timeline at the bottom of the map is not involved — it belongs to
the data, and a grid of one hour has no need of it.

If the map holds still, look for three reasons before anything else: **Animation → Animate** is off,
the panel is scrolled out of view, or this machine is set to reduce motion. In all three the
streamlines are still drawn, end to end rather than as moving trails.

## 6. Tune it, on the layer

Open the layer in the side panel — it is called **Streamlines**. Everything about how the field is
drawn is in there, in four groups.

Start with **Streamlines → Lines per screen**, 9,000 by default. Zoom in and out: the density and
the on-screen line length hold steady, because the field is re-traced whenever the map settles — a
fixed budget of lines per _screen_, not per dataset.

There is no value that suits every map. A field over a whole country wants more lines than a pair of
three-kilometre patches around two weather stations, and a field of parallel arrows reads as a solid
block at a density a swirling one reads well at. Lower it when the field looks matted, raise it when
it looks sparse.

### Walking the forecast

Not a second query: another query for another hour becomes its own dataset, and so its own
Streamlines layer stacked on top of this one — kepler has no way to merge them back into one field,
and the map's time filter binds only to the **first** dataset it finds with a timestamp column, so
the second layer would sit there deaf to the clock. One query, unnesting the hourly arrays Open-Meteo
already gives you, is what turns "the whole day" into "one row per hour":

```sql
SELECT round(latitude  * 4) / 4 AS latitude,
       round(longitude * 4) / 4 AS longitude,
       CAST(UNNEST(hourly.time[1:3]) AS TIMESTAMP) AS "time",
       UNNEST(hourly.wind_speed_10m[1:3])     AS speed,
       UNNEST(hourly.wind_direction_10m[1:3]) AS direction
FROM read_json_auto('https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&hourly=wind_speed_10m,wind_direction_10m&forecast_days=1');
```

`hourly.time`, `hourly.wind_speed_10m` and `hourly.wind_direction_10m` are parallel arrays, one
entry per forecast hour. DuckDB unnests same-length lists together, position by position, rather
than crossing them — so this turns the tutorial's 49 rows of "the whole day" into 49 × 3 rows of
"one hour each." `[1:3]` keeps it to the first three hours; drop the slice for the whole day, at
forty-nine times the rows. `CAST(… AS TIMESTAMP)` matters as much as the unnesting itself: without
it Open-Meteo's timestamp strings stay text, and a query that never names a time column is exactly
what section 5 described — a field with nothing for the map's clock to hold onto.

Every hour now reaches the panel as one dataset; it is the map's own clock, at the bottom, that
picks which one the field draws, always the **latest** hour still inside its window.

Drag the clock's window back and the field redraws for an earlier hour without its lines jumping to
a fresh scatter — they stay anchored to the same patch of ground, so what changes is the shape of
the flow, not where it starts. Widen the window back out and the newest hour wins again.

## 7. Style it

Two knobs decide the character of the map, both under **Streamlines**:

- **Trail length** — how much of the cycle the moving trail spans. Short reads as drifting
  particles, long as complete streamlines closer to a classic wind chart.
- **Stroke width** — in pixels, so it holds as you zoom.

Colour comes from speed by default: each line is coloured by its own mean, through the ramp under
**Colour**. Turn **Colour by speed** off for a single flat colour.

**Animation → Cycle** is the length of the loop. **Line lifetime** next to it is how much of the
field is lit at once — raise it for a fuller map.

Leave **Seamless loop** on. Off, the field visibly empties as the animation reaches the end and
refills as it starts again; on, a line that runs past the end is carried round to the beginning and
the density holds steady.

## 8. Two levels at once

Add a second query for another height — `wind_speed_80m` and `wind_direction_80m` from the same
endpoint. Each query becomes its own layer, with its own density: two levels asking for 9,000 each
put 18,000 lines in the same pixels, so lower both if they stop being tellable apart.

To separate them vertically, set **Field → Height (m)** on each layer — 10 m for the 10 m wind, 80 m
for the 80 m one — and tilt with the 3D control. (A height column bound to the layer's optional
`altitude` column does the same job, for queries that return one.)

The exaggeration is worked out from the taller of the two, so what the metres decide is the
**proportion**: how tall the stack is drawn is **Vertical exaggeration**, right below.

Height is opt-in on purpose — an `elevation` column mapped by accident lifts a layer kilometres into
the air. Expect to need a lot of exaggeration; the panel computes it from the viewport, scaling the
stack to about 15% of the view's width, because levels a few kilometres apart are invisible over a
region hundreds of kilometres wide.

## 9. Holes are holes

Cells your query omits are treated as **absent**, not as calm air, and streamlines stop at their
edge.

That is the mechanism for a pressure level that runs below ground: omit those cells and the lines end
at the mountains instead of drawing weather through rock. With a surface-level field it does not
arise — but it is why the field is not simply interpolated across gaps, and it is also why a
half-broken grid produces a patchy map rather than a smooth wrong one.

## What you learned

- A grid of velocities is not a table of places; the geometry is computed, not queried.
- **The grid must be regular**, and a coordinate API that snaps to its own model grid will quietly
  destroy that. Round, and space wider than the snapping error.
- A field with no lines and no error is the signature of a failed grid inference.
- The streamlines animate on their own clock; the map's timeline is for the data, not for them.
- Density is a per-screen budget, and it lives on the layer along with everything else.

## Where to go from here

- [Wind and other velocity fields](../guide/data/velocity-fields) — the full reference, including
  [the gradient mode](../guide/data/velocity-fields#the-gradient-of-a-value), which draws the same
  streamlines from a single column of terrain, pressure or temperature.
- [DuckDB](../guide/sources/duckdb-geoparquet) — the other things `read_json_auto` and `ST_Read` open.
- The [layer gallery](../layers/) — everything else the panel can draw.
