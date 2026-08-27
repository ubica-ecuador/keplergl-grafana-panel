# Zarr stores

A Zarr store is neither a file nor a service: it is a directory of compressed chunks with named
dimensions, published as-is on object storage. So the query hands over an address and the name of
one array inside it, and the panel builds the dataset and its layer.

```sql
SELECT 'https://ncsa.osn.xsede.org/Pangeo/pangeo-forge/gpcp-feedstock/gpcp.zarr' AS zarr_url,
       'precip' AS zarr_variable;
```

| Role            | Detected from                       |
| --------------- | ----------------------------------- |
| Zarr URL        | `zarr_url`, `zarr`, `store_url`     |
| Zarr variable   | `zarr_variable`, `zarr_var`         |
| Zarr time label | `zarr_time_label`, `zarr_label`     |
| Zarr levels     | `zarr_levels`, `zarr_pyramid`       |
| Zarr selectors  | `zarr_sel`, `zarr_select`           |
| Zarr time axis  | `zarr_time_dim`, `zarr_dim`         |

The first two go together: a store holds many arrays, so a URL without a variable is not a picture.
**Both must be present or neither role applies.** As with the raster and WMS roles, none of them
appears in the Field mapping editor — alias them in the query if your columns are named otherwise.

`zarr_variable` is deliberately narrow. A bare `variable` column is an ordinary thing to find in a
long-format table, and claiming it would read a frame of unrelated measurements as a Zarr store.

## A tile server does sit in between

Unlike a WMS, this needs one, and it is the **Raster tile server** panel option — the same option
the raster path uses, because it means the same thing: the TiTiler this panel draws through. The
server opens the store, decompresses the chunks, reprojects to Web Mercator and applies the colour
ramp, so what reaches the browser is an ordinary PNG.

That division of labour is what makes this work at all:

- **Compression.** Practically every Zarr in the wild is written by xarray with `blosc`. Nothing in
  the browser or in DuckDB's raster extension reads it; `zarr-python`, which TiTiler uses, does.
- **CORS.** Many public stores send no CORS headers whatsoever, which would put them out of a
  browser's reach entirely. It does not matter here: the one fetching chunks is the server.

TiTiler 2.2.1 ships the `/zarr` router already, so a deployment that already renders COGs needs
nothing new.

What the query produces is a dataset with no rows — `grafana-<refId>-zarr` — holding the store, the
variable and the colouring, alongside the ordinary table dataset your rows make.

## The colour range is not optional

A COG written for drawing carries its own sensible range. A scientific Zarr does not: it holds
physical units — kelvin, mm/day, a reflectance — and nothing in it says which slice of that range
deserves a colour.

Left empty, each tile is stretched over its own extremes, so neighbouring tiles disagree about what
a colour means and the map reads as patchwork. Set **Zarr value range** to the range you actually
want to see: `0,30` for mm/day of rain, `270,305` for sea-surface kelvin. The **Raster colour ramp**
option above it is shared with the raster path.

## The clock, and the label that goes with it

A store holds every moment in one place, so walking the timeline costs no query and no reload — the
panel rewrites one parameter of the tile URL and the tiles on screen are refetched. Add a time
column and the map's time widget walks it:

```sql
SELECT dia::TIMESTAMPTZ AS time,
       'https://.../gpcp.zarr' AS zarr_url,
       'precip'                AS zarr_variable
FROM …
ORDER BY time
```

**`zarr_time_label` exists because the match is literal.** The label is handed to xarray's `.sel`,
which compares exactly and offers no nearest-neighbour fallback. Left out, the panel spells the
timestamp the way numpy stamps a `datetime64[ns]` — `2000-01-05T00:00:00.000000000` — which is right
for a store stamped on the hour. It is wrong for one stamped at 09:00, as NASA's MUR SST is, and the
symptom is every tile answering `500` with *not all values found in index 'time'*.

When the store's labels do not match, take them from the store and pass them through:

```sql
strftime(dia, '%Y-%m-%dT09:00:00') || '.000000000' AS zarr_time_label
```

`GET <server>/zarr/info?url=<store>&variable=<name>` lists every label under `band_descriptions`,
which is the reliable way to find out what a store answers to. It is not a small response — one
store of 6 443 days answers with 1.2 MB — so read it once while building the dashboard rather than
from the panel.

## More than one axis to pin

A store is not obliged to have exactly one dimension beyond `y` and `x`. CarbonPlan's climate demo
has a band and a month; give `zarr_sel` the pairs, comma separated, and each becomes its own `sel`:

```sql
SELECT '…/tavg-prec-month' AS zarr_url,
       'climate'           AS zarr_variable,
       'band=tavg,month=1' AS zarr_sel
```

Time is not listed there — the map's clock owns it, and it travels as the label above.

## When the temporal axis is not called time

A climate store often does not hold dates at all. CarbonPlan's demo keeps twelve months as
`month=1..12`: integers, under a dimension named `month`. The map's clock still walks it — the
query says which axis, and what each moment is called inside it:

```sql
SELECT make_timestamp(2020, m, 1, 0, 0, 0)::TIMESTAMPTZ AS time,  -- what the clock moves on
       'month'  AS zarr_time_dim,                                  -- the axis in the store
       m::TEXT  AS zarr_time_label,                                -- what that axis answers to
       …
FROM generate_series(1, 12) t(m)
```

Naming the axis also switches off the timestamp fallback, deliberately: a store holding months
answers to `7` and never to `1996-10-01T00:00:00.000000000`, so guessing there would be a `500` on
every tile. Name a dimension and you owe it labels.

## Pyramids: what makes a store fast

This is the single biggest factor, and it is a property of the store rather than of the format.

A Zarr has no overviews unless it was written with them, so at a continental zoom the server reads
native resolution. Chunks that span the whole time axis make it worse: reading one day pulls every
day in the block. Measured on GPCP, whose chunks hold 200 days of the whole globe at 29 MB
compressed apiece, tiles came back in **1.2 s to 17.5 s**, and got slower the further you zoomed out.

A store written for maps behaves completely differently. Measured against the same server, on
CarbonPlan's pyramided demo — six `multiscales` levels, 128×128 chunks, already in Web Mercator:

| Zoom | Pyramided store | GPCP, no pyramid |
| ---- | --------------- | ---------------- |
| z=2  | 0.43 – 2.2 s    | 2.8 – 9.0 s      |
| z=3  | 0.53 – 2.0 s    | 2.1 – 5.2 s      |
| z=5  | 0.22 – 1.9 s    | worse still      |

Flat across zoom, and four to ten times quicker. Writing the same data locally both ways confirms
the format itself is not the cost: a well-chunked Zarr read 0.06 s against a COG's 0.023 s, while
the same data in one big chunk took 0.16 s.

**Tell the panel how deep the pyramid is** and each zoom asks for its own level:

```sql
SELECT '…/tavg-prec-month' AS zarr_url,
       'climate'           AS zarr_variable,
       6                   AS zarr_levels
```

`zarr_levels` is needed because the server will not do this by itself: `titiler.xarray` does not
read the `multiscales` convention at all. What it does offer is a `group` parameter that selects a
subgroup, and a pyramid written by [ndpyramid] names its groups `0`, `1`, `2` … by zoom — so the
panel puts `group={z}` in the tile template and lets deck.gl fill in the zoom.

Declaring the depth also stops the map asking for levels the store does not have. Past the deepest
one, deck reuses the tiles it already holds; without the count it would ask for group 6, 7, 8 and be
answered `500` on every tile.

Leave `zarr_levels` out for a store with no pyramid — it answers at any zoom, just slowly.

[ndpyramid]: https://github.com/carbonplan/ndpyramid

## Measuring, not only drawing

The same server answers questions about the store as well as painting it, over a polygon you draw on
the map or a coordinate you click — and with the same `variable`, `sel` and `group`, so the number
is about the slice on screen. That has a page of its own:
[Measuring imagery](../sources/measuring-imagery#zarr).

## What is left when the store is right

A cache in front of the tile server is still worth having: nothing is reused between requests, so
two tiles sharing a chunk fetch it twice.
