# Forecasts from an Icechunk archive

NOAA's Global Forecast System runs four times a day and predicts sixteen days ahead on a quarter-degree
global grid. dynamical.org keeps every run since May 2021 as an [Icechunk] repository, twenty-five
variables of it, under CC BY 4.0. This page draws one of them on the map, hour by hour, from the
newest run — temperature, humidity, cloud, pressure or a wind component, whichever the dashboard's
picker is on.

The mechanism — what Icechunk is, why a Zarr reader cannot open one, and how the two address forms
work — is on the [Zarr stores](../data/zarr#icechunk-repositories) page. This is the worked example.

[Icechunk]: https://icechunk.io

## The server has to speak Icechunk

Everywhere else in these guides, a stock TiTiler is enough. Not here: opening a repository means
reading a pointer object, a snapshot and a manifest before any chunk can be found, and only the
`icechunk` client does that. The image built in this repository's `docker/titiler/` adds it — a
`pip install` and a module that swaps the opener behind the `/zarr` router. In essence:

```python
def open_icechunk(src_path, group=None, decode_times=True, decode_coords="all", **kwargs):
    repo = icechunk.Repository.open(icechunk.http_storage(icechunk_href(src_path)))
    session = repo.readonly_session("main")
    return xarray.open_dataset(session.store, engine="zarr", decode_coords=decode_coords)


def open_any(src_path, **kwargs):
    """Anything that does not name Icechunk goes to the stock opener, untouched."""
    if icechunk_href(src_path) is not None:
        return open_icechunk(src_path, **kwargs)
    return open_zarr(src_path, **kwargs)
```

The router stays mounted at `/zarr` rather than moving to a prefix of its own, so the panel needs no
change and every plain Zarr dashboard keeps working against the same server. Two details the module
takes care of that are easy to miss when writing your own:

- **The stock `/zarr` router has to be switched off before it mounts**, with
  `TITILER_API_DISABLE_ZARR=TRUE`, or it wins every request and yours is never reached.
- **The opened repository is cached with a deadline, not forever.** Opening one costs about four
  seconds, which no tile can pay, but the archive commits a new forecast every six hours and a
  permanent cache would freeze it at whatever the container saw on startup. A fifteen-minute
  deadline amortises the cost and still picks up new runs. Because each cache entry holds a
  snapshot, a screenful of tiles is always one consistent version of the archive.

## A forecast has two time axes

This is the part that has nothing to do with Icechunk and everything to do with forecasts, and it is
what makes the query look unusual.

An observational archive has one time axis. A forecast archive has two:

| Axis        | What it is                            | In this archive         |
| ----------- | ------------------------------------- | ----------------------- |
| `init_time` | when the model run started            | every 6 h since 2021-05 |
| `lead_time` | how far ahead that run is predicting  | 0–384 h, 209 steps      |

The moment a value is *about* is `init_time + lead_time`, so any picture needs both pinned. Which
one the map's clock should walk is a question about what you want to see, and there are two honest
answers:

- **Pin the run, walk the lead.** One forecast, playing forward. This is the usual one, and what
  this page does.
- **Pin the lead, walk the run.** How the prediction for a fixed horizon has changed as newer runs
  came in — useful, and a completely different picture.

Either way one axis goes to `zarr_sel` and the other to `zarr_time_dim`.

## The query

One row per forecast hour. The database is not reading the archive and could not — it is working out
*what to ask for*, and the tile server resolves it:

```sql
WITH run AS (
  -- GFS starts every 6 h and the archive takes a while to ingest a run, so take
  -- the last 6-hourly slot that is already 9 hours old. It is margin, not
  -- precision: asking for a run that is not there yet draws empty tiles.
  SELECT to_timestamp(floor(epoch(now() - INTERVAL '9 hours') / 21600) * 21600) AS init
)
SELECT
  init + INTERVAL '1 hour' * h AS time,
  'stac+https://stac.dynamical.org/noaa-gfs-forecast/collection.json' AS zarr_url,
  'temperature_2m' AS zarr_variable,
  -- the clock walks the lead, not `time`
  'lead_time' AS zarr_time_dim,
  -- lead times are given in nanoseconds
  (h * 3600 * 1000000000)::BIGINT::VARCHAR AS zarr_time_label,
  -- and the run is pinned, in the spelling numpy uses for a timestamp
  'init_time=' || strftime(init AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%M:%S.000000000') AS zarr_sel
FROM run, generate_series(0, 48) g(h)
ORDER BY time
```

The `time` column carries the *valid* moment — the hour the forecast is about — which is what makes
the map legible: the clock reads Tuesday 15:00, not "+27 h".

Set **Raster tile server** to a server carrying the opener, **Zarr value range** to something like
`-10,35` for degrees Celsius, and a **Raster colour ramp**.

## Choosing among the twenty-five variables

A cube holds them all, so switching is a matter of one string. Add a dashboard variable and pass it
to `zarr_variable` — bare, because the DuckDB datasource quotes variables itself and a quoted one
arrives as `''temperature_2m''`:

```sql
$variable AS zarr_variable
```

The catch is that they do not share a scale: pascals near 101 000 and degrees Celsius near 20 cannot
be stretched over the same range, and a picker that only changed the array would paint a flat sheet
for every choice but one. So send the range and the ramp **with the row** — both are field roles
(`zarr_rescale`, `zarr_colormap`) and a value there beats the panel option:

```sql
CASE $variable
  WHEN 'temperature_2m'                     THEN '-10,35'
  WHEN 'relative_humidity_2m'               THEN '0,100'
  WHEN 'pressure_reduced_to_mean_sea_level' THEN '98000,103000'
  WHEN 'wind_u_10m'                         THEN '-15,15'
  ELSE '-10,35'
END AS zarr_rescale
```

One panel still draws one variable: each query is its own layer, so two variables at once means two
queries, not a multi-valued picker.

## Which clock walks the forecast

A forecast has not happened yet, and Grafana's default range ends at `now`, so a dashboard left on
it draws the run's first hour and never moves. There are two ways out, and the choice is not free.

With **Time range sync** on its default `toMap`, the dashboard range drives the map: set it to
`now-6h` → `now+2d` (Grafana accepts a future bound) and the map draws the hour at the end of the
range. Measured, `to=now+6h` draws the 15-hour lead and `to=now+30h` the 39-hour one.

Set it to `variables` instead and the direction reverses. The dashboard range stops moving the map,
the map's own time bar becomes the control, and the panel publishes the window it is showing into
two dashboard variables. **That is what a statistic beside the map needs**, because nothing else
tells the rest of the dashboard which hour is on screen: `toMap` is one-way, and only
`bidirectional` writes the map's window back to the dashboard range — at the cost of turning every
frame of an animation into a range change, measured at 92 queries in ten seconds.

So a board that only draws can keep `toMap`; a board that also measures wants `variables`, and then
the time bar under the map is the thing to drag. Either way, if you press play, switch that bar's
window mode to *incremental*: in the default *free* mode the window is as wide as the whole forecast
and slides without ever changing which hour is drawn.

### Opening on the present hour

Left alone, `variables` sync seeds the map's clock with the data's own domain, and the map always
draws the newest hour inside its window — so a forecast board opens two days in the future, which is
a strange thing to greet someone with.

The fix is that the seeding runs in only one direction. On the first pass, variables that already
carry a window **win over the map** — that is what makes a shared link restore someone's brush — so
filling `mapFrom` and `mapTo` before the map speaks decides where it opens. Make them query
variables against the database, returning the hour nearest now, with `refresh` set to **on load**
rather than on time-range change: the map has to own them from the second pass onward, or dragging
its clock would be undone.

Emit them in the same ISO shape the panel itself writes (`2026-09-08T03:00:00.000Z`). Anything else
works for the map — the parser takes epoch milliseconds too — but every other consumer of those
variables then has two formats to handle, and the one that is never exercised is the one that
breaks.

### Clicking the chart to move the map

The same seam takes a click. Put a data link on the chart's fields, with `oneClick` so a plain click
follows it, pointing back at this dashboard with the clicked instant in a variable:

```
/d/<uid>?${__url_time_range}&var-variable=${variable:percentencode}&var-clic=${__value.time}
```

Then let `mapFrom`/`mapTo` read that variable instead of only the present hour —
`coalesce(the clicked instant, the hour nearest now)` — and clicking a point walks the map to it.
The arithmetic (six hours back for the window's left edge) belongs in that query, because a data
link can only carry a value, not compute one.

**The map's rows have to cover what the chart draws.** The chart comes back with every forecast hour
the archive publishes; a map query offering a round `generate_series(0, 48)` cannot follow a click
beyond two days, and kepler silently clamps the window to its own domain instead — the map lands on
its last step and looks like it ignored you. Emit the real list: hourly to 120 hours, then every
three to 384.

```sql
FROM run, (SELECT unnest(range(0, 121)) AS h UNION ALL SELECT unnest(range(123, 385, 3)) AS h) g
```

Two limits worth knowing before promising this to anyone. **A link that already carries the clicked
hour loses the race**: the panel opens the time filter to the full domain once, when the data lands,
which is after the variables were adopted — so a deep link or a shared URL arrives at the last step
rather than where it pointed. Clicking inside an open dashboard is unaffected, because that opening
happens once per mount. And **a time series panel cannot be stopped from zooming the dashboard's
range**: it passes `queryZoom` unconditionally, with no option in between. The Trend panel does not,
at the price of a numeric x-axis and no time annotations.

## Measuring the shape you draw

The same server answers questions about the slice it is painting, so a polygon on the map becomes a
mean, a minimum and a maximum without a second source. The chain has a page of its own —
[Measuring imagery](measuring-imagery#zarr) — and it works against an Icechunk address unchanged:

- the **`areaVariable`** panel option publishes the drawn figure as WKT;
- a DuckDB variable turns that into GeoJSON with `ST_AsGeoJSON(ST_GeomFromText(…))::VARCHAR`;
- Infinity `POST`s it to `/zarr/statistics` with the same `variable` and `sel` the tiles carry, so
  the number is about the hour on screen and not about some other one.

The hour has to come from the map, not from `$__timeTo()`. Deriving it from the dashboard range
looks right and holds still: the range does not move when the map's clock does, so the figures
freeze at whatever hour the board opened on while the map goes on painting new ones. With
`variables` sync the panel publishes `mapTo`, and a query variable that reads it re-runs whenever it
changes.

Two things make it work on arrival rather than after the first click. The map starts with a polygon
already drawn — kepler's saved config carries `visState.editor.features`, and a figure put there is
rendered on load. Only `features` and `visible` survive that round trip, though, not the editor's
`mode`: the map opens in `DRAW_POLYGON`, where a click begins a new shape instead of picking up the
one already there, so moving it takes an **Escape** or a click on the edit tool first. And the
GeoJSON query falls back to that same polygon
(`coalesce(nullif('${area}', ''), '<the same WKT>')`), because the area variable is still empty until
someone moves it: on the first pass the panel *adopts* a restored figure rather than publishing it,
so that a shared link's value is never overwritten.

**Watch the cell count**, which the request returns alongside the statistics. A quarter of a degree
is roughly 28 km, so a shape has to be regional before a mean over it means much: a box spanning the
Ecuadorian coast and the Andes covers 70 cells and gave 18.7 °C between 4.9 and 24.8 — the spread
you would expect of a shape holding both beach and páramo — while the recharge basin of the Mazar
dam, a real catchment and the one the provisioned board draws, is **twelve cells**. Twelve is enough
for the shape of a day and too few for the shape of a valley. Drawn over a city it would be one
cell, and a mean of one cell is just that cell.

### The whole forecast as a series, in one request

A statistic at the hour on screen is one number. The same endpoint gives the entire forecast if you
**leave the lead-time axis unpinned**: fix the run and say nothing about `lead_time`, and the server
treats that axis as bands, answering with one per forecast hour — `b1`, `b2`, … `b209` — each
carrying its own mean, minimum, maximum and count, and a `description` holding the lead in
microseconds. Sixteen days of forecast, **209 hours in about four seconds**, instead of 209 requests.

Turning that into rows is a job for the database rather than for a JSON parser, because the bands
arrive as an object rather than a list:

```sql
LOAD http_client; LOAD json;
WITH resp AS (
  SELECT (http_post(<url with the run pinned>, MAP {'content-type': 'application/json'},
                    <the GeoJSON feature>::JSON) ->> 'body')::JSON AS body
), st AS (
  SELECT body -> 'properties' -> 'statistics' AS s FROM resp
), bands AS (
  SELECT s, unnest(json_keys(s)) AS b FROM st
)
SELECT run + to_microseconds(CAST(regexp_extract(
         json_extract_string(s, '$."' || b || '".description'), '^[0-9]+') AS BIGINT)) AS time,
       json_extract(s, '$."' || b || '".mean')::DOUBLE AS mean
FROM bands
ORDER BY time
```

### Marking the hour the map is showing

A sixteen-day curve does not say where you are standing on it. A dashboard annotation does — a
vertical line at the hour on screen, which lands exactly on the peak the stat panels are reporting.

It has to come from Infinity: the DuckDB datasource declares no annotation support, so it does not
appear in the annotation picker at all. Infinity does, and its **inline** source needs no server —
the whole annotation is a literal carrying a dashboard variable:

```json
{ "source": "inline", "data": "[{\"time\": \"${drawnHour}\", \"text\": \"the hour the map is drawing\"}]",
  "columns": [{ "selector": "time", "text": "time", "type": "timestamp" }] }
```

Compute that variable from the same lead the statistics use rather than from `mapTo`: `mapTo` is the
edge of the map's window and can fall between two hours, while what is drawn is always one exact
forecast hour.

Three details that cost a debugging round each. **`to_microseconds`** rather than
`INTERVAL '1 microsecond' * n`: the multiplication takes an `INT32` and a lead of 3 600 000 000
overflows it — and feed it `//`, integer division, because `/` yields a `DOUBLE` and there is no
`to_microseconds(DOUBLE)`. **The variable interpolation in a panel query is not uniform**: the
DuckDB datasource quotes a bare `$variable` for you, but a format modifier switches that off, so
`${store:percentencode}` arrives raw and needs quotes of its own, while a value carrying double
quotes (a GeoJSON geometry) comes back escaped and has to travel as `'${zona:raw}'` to survive. And
**a failing panel says only "No data"** — the message lives in a tooltip on the panel's status icon,
with nothing in the browser console, so a query that never ran looks exactly like a query that
returned nothing.

## A wind field from the same archive

The archive carries `wind_u_10m` and `wind_v_10m`, which are exactly what the
[Flow field layer](../data/velocity-fields) wants — but that layer needs a **row per grid point**,
and the only thing that can read this archive is the tile server. Asking it point by point is
ninety-eight round trips for a seven-by-seven lattice, and the database issues them one at a time:
measured through DuckDB, **27.7 s**, with the first attempt dying on Grafana's timeout.

The same statistics endpoint takes a `FeatureCollection`, walks `features` in order and writes a
`statistics` object into each one — so a lattice of small squares comes back as a lattice of values,
and the whole seven-by-seven fits in **one call per component**, in about seven seconds.

Send it that way and it will fail on a cold server, though, because of a ceiling on the other side:
**DuckDB's `http_client` abandons a response after ten seconds**, exposes no setting to change it
(`http_timeout` belongs to httpfs and this extension ignores it), and reports the failure as
`status -1` with an *empty body* — which, cast to JSON, surfaces as `Malformed JSON at byte 0` and
reads like a bug in the query. The same call against a cold server measured 10.0 s. So the lattice
goes in **three batches per component, six requests**, and the cast is guarded:

```sql
CASE WHEN (r ->> 'status') = '200' THEN (r ->> 'body')::JSON
     ELSE error('the tile server did not answer: ' || coalesce(r ->> 'reason', '?')) END
```

```sql
WITH grid AS (                        -- generated here, with integers divided at the end
  SELECT (-275 + i * 25) / 100.0 AS latitude,
         (-7900 + j * 25) / 100.0 AS longitude
  FROM (SELECT unnest(range(-3, 4)) AS i) a, (SELECT unnest(range(-3, 4)) AS j) b
), fc AS (
  SELECT json_group_array(json_object(
           'type', 'Feature',
           'properties', json_object('lat', latitude, 'lon', longitude),   -- comes back intact
           'geometry', json_object('type', 'Polygon', 'coordinates', <a ±0.05° square>))) AS feats
  FROM grid
)
SELECT latitude, longitude,
       max(val) FILTER (WHERE comp = 'u') AS u,      -- the aliases the layer looks for
       max(val) FILTER (WHERE comp = 'v') AS v
FROM <the two responses, unnested>
GROUP BY latitude, longitude
```

Four things decide whether this draws anything at all:

- **Each square must sit well inside one cell.** A quarter of a degree leaves ±0.125° of margin, and
  ±0.05° uses less than half of it. Check `count` in the answer: it has to be **1**. A square that
  spills over averages its neighbours in silently, and the field loses its structure — which reads
  as calm weather rather than as a bug.
- **The lattice must be generated by the query**, from integers divided at the end, and never rebuilt
  from the coordinates the server echoes back. The layer rejects a lattice whose spacing wobbles by
  more than 5% and then draws nothing while saying nothing.
- **`wind_u_10m` is not one of the aliases** the layer recognises, and none of these roles appears in
  the Field mapping editor. `AS u` and `AS v` are the whole contract.
- **Send the properties you want back.** Each feature carries its own `lat`/`lon` out and gets them
  back untouched, so the two answers are joined on coordinates rather than on the order of an array.

The cost is **the number of points, not the ground they cover**: about 100 ms per feature, all of it
`rio-tiler` clipping and reprojecting a one-pixel window, and none of it reading the archive once the
chunk is cached. So forty-nine points cost about ten seconds across the six requests whether they are
spread over 1.5° at the archive's own resolution or over 3° taking every other cell. Splitting
further does not buy proportional safety — measured cold, a request of nine cells still took 6.5 s to
10.3 s, because what is slow is opening the repository and fetching the first chunk, not the cells.
That is what `ICECHUNK_PRELOAD` is for: it holds the repository open from boot, in every worker, so
no request pays for opening it.

There is no walking the forecast here. A flow field holds one instant — the panel keeps the first
moment a query offers and drops the rest along with the time column — so the hour comes from a
dropdown that re-runs the query, and the map's own time bar is a sixty-second loop that animates the
streaks rather than a clock over the forecast.

### A raster under the field

A second query in the same panel paints one of the archive's own variables underneath, on the same
run and the same hour, because it is built from the same two variables the arrows are. It returns a
single row of `zarr_*` roles and no data — and **no rows at all** when the picker says *nothing*,
which is how the raster is switched off.

There is no wind speed to paint: the archive publishes `u` and `v` components only, `/zarr/tiles`
takes one `variable` and has no `expression`, and a variable derived in the opener would be eager
over the whole four-dimensional cube. So what goes under the wind is a field beside it — cloud,
temperature, rain — rather than the wind itself.

Two things this ran into, both worth knowing anywhere:

- **The hour is a selector here, not a time role.** `zarr_time_label` is read only from a query that
  has a `time` column, and a flow field deliberately has none. Pinned in `zarr_sel` alongside the
  run, it reaches the tiles; given as a time role it silently does not.
- **A named ramp is opaque end to end.** Cloud cover is mostly zero, and every named ramp paints
  those zeros as a solid sheet over the basemap and the arrows both. Alpha can only come from the
  ramp itself, so those fields carry an interval ramp whose low end fades to nothing — the intervals
  in `0–255`, since the range rescales onto the byte before the ramp colours it.

`gfs-wind` on the sources bench draws it.

## What it costs

The archive is chunked for reading a long series at one place, which is the opposite of what a map
wants. One chunk holds 105 forecast hours over a 30° square — 0.9 MB compressed, 5.9 MB unpacked —
so drawing a single hour pays for a hundred and four you did not ask for.

That is also why **the chunk cache matters more here than the chunking does**. Icechunk ships it
off — `num_bytes_chunks` defaults to `0` — so without it every read fetches and decompresses its
chunk again however many times the same one is wanted, and a chunk this size is wanted constantly:
a screenful of tiles and a whole regional lattice of statistics all live inside one. The image in
this repository's `docker/titiler/` turns it on, and it is one line of `RepositoryConfig`.

Measured against the image described above, reading the repository over HTTPS, with the cache on and
the same reads without it:

| What                                       | Time         | Cache off  |
| ------------------------------------------ | ------------ | ---------- |
| One tile over Ecuador                      | 0.4 – 2.8 s  | 2 – 9 s    |
| The whole world at zoom 0                  | 11.5 s       | 28.8 s     |
| The same one-cell window, read again       | 0.007 s      | 0.8 – 1.8 s |
| A 9×9 lattice of statistics, both components | 16 s        | 171 s      |
| A plain Zarr store through the same server  | 3.5 s       | 3.5 s      |

A screenful over a country is 23 to 34 tiles and lands. A screenful of the globe is the same work
seventy-two times over, and it still shows. Two things help and neither is exotic: keep the map
regional, and put an HTTP cache in front of the tile server, since nothing is reused *between*
requests even now.

The cache is per repository and per worker, so its ceiling is its size times the open repositories
times `WEB_CONCURRENCY`. `ICECHUNK_CHUNK_CACHE_BYTES` raises or lowers it; 128 MB holds about twenty
of GFS's chunks unpacked, which is a region at any zoom.

None of that is Icechunk's doing — a plain Zarr with the same chunking would cost the same. It is
worth knowing before promising anyone a global animation.

## Provisioned dashboard

`gfs-forecast` on the sources bench draws exactly this, over Ecuador, and its panel carries the
query above. `gfs-wind` draws the wind field from the same archive.

## When this is the wrong tool

**When you want numbers at a place, not a picture.** A point across all 209 lead times is one chunk
read and about a second — the shape the archive was built for. That belongs in a notebook with
`icechunk` and `xarray`, and the answer is a chart, not a map:

```python
repo = icechunk.Repository.open(icechunk.http_storage(href))
ds = xarray.open_zarr(repo.readonly_session("main").store, chunks=None)
ds.temperature_2m.isel(init_time=-1).sel(latitude=-2.9, longitude=-79.0, method="nearest")
```

**When the archive also publishes a plain Zarr.** Then use it and skip all of this — the panel needs
no special server, and the [Zarr stores](../data/zarr) page is the whole story.

**When you need a global animation at speed.** The chunking will not allow it. Rewriting the slice
you care about as a pyramided store, or as COGs, moves the cost to a job that runs once instead of
to every viewer.
