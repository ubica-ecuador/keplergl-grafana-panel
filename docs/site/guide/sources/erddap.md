# ERDDAP — gridded ocean data over HTTP

[ERDDAP] is the data server most of the world's oceanographic agencies publish through: NOAA,
IOOS, PacIOOS, CSIRO, EMODnet. A dataset on one of them is a gridded array — sea surface
temperature, wave height, currents, chlorophyll — and the server will hand you any rectangle of it
in whatever format you name.

The useful part for this panel is that one of those formats is CSV. **There is no ERDDAP client
here, and no extension to install**: `read_csv` over HTTPS is the whole adapter, and the result is
a table of coordinates and values that the [velocity field](../data/velocity-fields) layer or a
point layer reads directly.

[ERDDAP]: https://coastwatch.pfeg.noaa.gov/erddap/information.html

## The response format that matters is `.csv0`

An ERDDAP request is a base URL, a dataset id, an extension and a subset expression:

```
https://<host>/erddap/griddap/<dataset>.<ext>?<var><subset>,<var><subset>
```

The extension chooses the shape of the answer, and three of them are CSV:

| extension | first rows |
| --- | --- |
| `.csv` | a header row **and** a units row |
| `.csvp` | one header row, units folded into the names — `Thgt (meters)` |
| `.csv0` | no header at all |

Use **`.csv0`**. The other two make `read_csv` guess, and `.csv`'s second row of units turns every
column into `VARCHAR`. With no header there is nothing to guess: name the columns yourself and the
types are settled.

```sql
FROM read_csv('…', header = false,
  columns = {'c0': 'TIMESTAMP', 'c1': 'DOUBLE', 'column2': 'DOUBLE',
             'column3': 'DOUBLE', 'column4': 'DOUBLE', 'column5': 'DOUBLE'},
  nullstr = 'NaN')
```

The column order is the dimensions in declaration order, then one column per variable requested.

## The subset expression

`[(value)]` for a coordinate, `[(from):stride:(to)]` for a range, `[index]` for a raw index.

Only `[` and `]` need percent-encoding, as `%5B` and `%5D`. Parentheses, colons and commas travel
raw, which keeps the URL readable inside a SQL literal.

Three things about it are worth knowing before you spend an afternoon on them.

**A requested coordinate snaps to the nearest one on the axis.** Asking for `07:17` on an hourly
axis returns `07:00` rather than an error, so a time computed in SQL does not have to match the
grid exactly.

**`last` and `last-N` work; `now` arithmetic may not.** `time[last-168:3:last]` is a sliding window
onto the newest data and needs no clock on your side. On the PacIOOS server `(now-1day)` is
rejected with `Start=NaN (invalid format?)` — do not assume the relative-time syntax in ERDDAP's
documentation is enabled everywhere.

**Two variables in one request must carry byte-identical subset expressions.** This is the one that
costs real time, because of how the failure surfaces: ERDDAP answers 400, and DuckDB reports it
fourteen seconds later as

```
HTTP Error: HTTP GET error on 'https://…' (HTTP 0 Internal Server Error)
```

which names neither the mismatch nor the server. Build the subset once as a string and repeat it.

## Longitude, and the land mask

Two conversions stand between an ERDDAP grid and a map.

**Longitude is often published in 0..360.** `longitude - 360` for the western hemisphere, and
because 0.5 and its multiples are exactly representable in binary floating point, the result is
exact — which matters, because the velocity field layer refuses a lattice whose spacing wobbles by
more than 5%.

**A land cell must be absent, not null.** ERDDAP writes `NaN` in cells the model does not cover.
`nullstr = 'NaN'` turns that into SQL `NULL`, and then you must **filter those rows out**:

```sql
WHERE column4 IS NOT NULL
```

This is not tidiness. The velocity field reads its inputs with `Number(value)`, and `Number(null)`
is `0` — so a land cell delivered as a row with NULLs enters the lattice as a velocity of zero,
which draws as *dead calm* rather than as a hole, and blurs that invented zero into its neighbours.
Only a cell that never arrives stays `NaN`, which is what masking means. The rule generalises to
every masked gridded source, and the mistake is quiet: the map looks becalmed, not broken.

Removing rows does not endanger the lattice. The step is inferred as the **minimum** gap between
distinct values, so as long as one adjacent pair survives anywhere — open ocean guarantees it — the
spacing is right and the missing cells are simply holes.

## The query

Significant wave height and peak wave direction from NOAA's WAVEWATCH III, as a velocity field.
`speed` and `direction` are the names the layer looks for; nothing else renames them, and neither
role appears in the field-mapping editor, so the alias is the whole contract.

```sql
SELECT column2       AS latitude,
       column3 - 360 AS longitude,
       column4       AS speed,
       column5       AS direction
FROM read_csv('https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ww3_global.csv0?Thgt%5B(2026-09-10T12:00:00Z)%5D%5B(0.0)%5D%5B(-7.0):1:(4.0)%5D%5B(265.0):1:(284.0)%5D,Tdir%5B(2026-09-10T12:00:00Z)%5D%5B(0.0)%5D%5B(-7.0):1:(4.0)%5D%5B(265.0):1:(284.0)%5D',
  header = false,
  columns = {'c0': 'TIMESTAMP', 'c1': 'DOUBLE', 'column2': 'DOUBLE',
             'column3': 'DOUBLE', 'column4': 'DOUBLE', 'column5': 'DOUBLE'},
  nullstr = 'NaN')
WHERE column4 IS NOT NULL
ORDER BY column2, column3
```

897 cells over that rectangle, 709 of them sea, in about two and a half seconds.

**Ask the metadata which direction convention you have.** The velocity field reads `direction` as
the bearing the wave or wind comes *from*. A dataset's `.das` says which it publishes, and guessing
is how a field ends up drawn backwards:

```bash
curl -s 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ww3_global.das' | grep -A8 '^ *Tdir'
```

`standard_name "sea_surface_wave_from_direction_at_variance_spectral_density_maximum"` — a *from*
direction, so it needs no correction. Had it been `..._to_direction`, the query would need
`(column5 + 180) % 360`.

## Painting the field as well as tracing it

Streamlines carry direction; the magnitude wants a coloured background under them. It does not need
a tile server — **the same rows can be the raster**, by emitting one square per model cell alongside
the point:

```sql
SELECT latitude, longitude, speed, direction,
       '{"type":"Polygon","coordinates":[['
         || '[' || (longitude - 0.25) || ',' || (latitude - 0.25) || '],'
         || '[' || (longitude - 0.25) || ',' || (latitude + 0.25) || '],'
         || '[' || (longitude + 0.25) || ',' || (latitude + 0.25) || '],'
         || '[' || (longitude + 0.25) || ',' || (latitude - 0.25) || '],'
         || '[' || (longitude - 0.25) || ',' || (latitude - 0.25) || ']'
       || ']]}' AS geojson
FROM celdas
```

`geojson` is one of the names read as a geometry role, so the column arrives as `_geojson` and a
GeoJSON layer points at it. One query, one dataset, two layers — and the background follows the
forecast picker for free, because it *is* the same rows. About 109 bytes a cell.

**Do not reach for kepler's `grid` layer here.** It bins points into cells of a size given in
kilometres, and a lattice spaced in *degrees* does not divide evenly into that: at these latitudes
it left a whole column of empty cells down the middle of the field and staircased every edge. An
explicit polygon is aligned by construction and costs no extra request.

::: tip Pin the colour scale, or two steps stop being comparable
`colorScale: "custom"` with a `colorMap` of `[threshold, colour]` pairs gives **absolute** breaks —
metres, here — the way a printed colour bar reads. `quantile` and `quantize` rescale to whatever is
on screen, so a calm day and a heavy swell paint identically. Let the polygons carry the magnitude
and turn the streamlines' own `colorBySpeed` off, or the map shows two colour scales that mean
different things.
:::

## Which clock, and why it is a dropdown

A velocity field holds **one instant**. The panel keeps the earliest timestep a query returns and
drops the rest along with the time column, so there is no forecast for the map's own time bar to
walk — that bar is a synthetic sixty-second loop animating the streaks.

So the forecast step is a Grafana template variable, and the list comes from the server rather than
from arithmetic:

```sql
SELECT strftime(paso::TIMESTAMP - INTERVAL '5 hours', '%d %b %H:%M') || ' local' AS __text,
       paso AS __value
FROM read_csv('https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ww3_global.csv0?time%5Blast-168:3:last%5D',
              header = false, columns = {'paso': 'VARCHAR'})
WHERE paso::TIMESTAMP >= date_trunc('hour', now() AT TIME ZONE 'UTC') - INTERVAL '3 hours'
ORDER BY paso
```

Read the axis as `VARCHAR` and hand it back untouched: what ERDDAP wrote is exactly what ERDDAP
accepts, and no timezone touches it on the way. The cast is only for the label.

Two quoting rules, and they point opposite ways. In a **panel** query the DuckDB data source quotes
variables by itself, so a step interpolated **inside a string literal** needs `${paso:raw}` — the
literal already supplies the quotes. In a **variable** query nothing is quoted for you.

## What it costs

Latency dominates, not size. Measured against PacIOOS through the DuckDB data source:

| request | time |
| --- | --- |
| the step list, ~57 timestamps | 0.7 s |
| one instant, 143 cells | 1.9 s |
| one instant, 897 cells, two variables | 2.5 s |
| one instant, 589 cells, three variables | 3.0 s |
| seven days at three hours, 14 537 rows, 772 KB | 10 s |

Which settles a design question: **there is no point narrowing the rectangle**. A small box and a
large one cost the same, so ask for the whole area of interest once and let the map's camera decide
what is looked at.

Note also that the request is made **server-side**, by DuckDB rather than by the browser. Unlike
the [WMS](../data/wms) route there is no content-security-policy to widen.

::: tip Follow the redirect once, then pin the host
`coastwatch.pfeg.noaa.gov/erddap/griddap/NWW3_Global_Best` answers 302 to PacIOOS. Point at the
host that actually serves the data — a redirect is one more thing that can change under you.
:::

## Provisioned dashboard

`oleaje-ecuador` on the sources bench draws exactly this: the WAVEWATCH III wave field over Ecuador
and the Galápagos, with the forecast step as a picker. One query, two layers over one dataset — the
streamlines for direction, half-degree polygons for the height.

It exists because [INOCAR]'s operational SWAN model — which runs this very variable on fine coastal
grids, and is the thing you would rather draw — publishes only rendered PNGs under
`/modelnum/swan/imagenes/`. No WMS, no THREDDS, no ERDDAP, no NetCDF. Half a degree is about 55 km,
so the global model gives the swell that dominates the Ecuadorian coast but not the refraction
inside the Gulf of Guayaquil. When an agency publishes pictures, an open global model is the
substitute — and it is worth asking them for the grid.

[INOCAR]: https://www.inocar.mil.ec/web/index.php/modelo-swan

## When this is the wrong tool

**You want a painted field rather than streamlines.** Many ERDDAP servers also expose WMS and
`.nc`; the [WMS layer](../data/wms) consumes the former without any of this. (Not every dataset
has it — `ww3_global` does not.)

**The subset is enormous.** CSV is a poor wire format for millions of cells. Past that point the
answer is a real archive — see [Zarr stores](../data/zarr) and
[Icechunk](./icechunk) — not a bigger `read_csv`.
