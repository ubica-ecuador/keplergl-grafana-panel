# Forecasts from an Icechunk archive

NOAA's Global Forecast System runs four times a day and predicts sixteen days ahead on a quarter-degree
global grid. dynamical.org keeps every run since May 2021 as an [Icechunk] repository, twenty-five
variables of it, under CC BY 4.0. This page draws one on the map: air temperature two metres above
the ground, hour by hour, from the newest run.

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

## The dashboard's range has to reach into the future

A forecast has not happened yet, and Grafana's default range ends at `now`, so a panel left on it
draws the run's first hour and never moves.

Grafana accepts a future bound. Set the dashboard to `now-6h` → `now+2d` and, with **Time range
sync** on its default `toMap`, the map draws the hour at the end of the range: narrow the range to
walk the forecast. Measured on the provisioned board, `to=now+6h` draws the 15-hour lead and
`to=now+30h` the 39-hour one, from the same run.

The map's own time bar plays it as an animation, with one setting worth changing: switch that bar's
window mode to *incremental*. In the default *free* mode the window is as wide as the whole forecast
and slides without ever changing which hour is drawn.

## What it costs

The archive is chunked for reading a long series at one place, which is the opposite of what a map
wants. One chunk holds 105 forecast hours over a 30° square — 0.9 MB compressed, 5.9 MB unpacked —
so drawing a single hour pays for a hundred and four you did not ask for.

Measured against the image described above, reading the repository over HTTPS:

| What                                    | Time     |
| --------------------------------------- | -------- |
| One tile over Ecuador                   | 2 – 9 s  |
| The whole world at zoom 0               | 28.8 s   |
| A plain Zarr store through the same server | 3.5 s |

A screenful over a country is 23 to 34 tiles and lands. A screenful of the globe is the same work
seventy-two times over, and it shows. Two things help and neither is exotic: keep the map regional,
and put an HTTP cache in front of the tile server, since nothing is reused between requests.

None of that is Icechunk's doing — a plain Zarr with the same chunking would cost the same. It is
worth knowing before promising anyone a global animation.

## Provisioned dashboard

`gfs-forecast` on the sources bench draws exactly this, over Ecuador, and its panel carries the
query above.

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
