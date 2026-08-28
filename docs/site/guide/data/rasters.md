# Satellite imagery and other rasters

A satellite scene is a file in a bucket, and its address is a string like any other — so a query
**can** hand one over. Return a column named `raster_url` and the panel builds a raster dataset from
it and lets kepler draw it.

```sql
SELECT 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/…/TCI.tif' AS raster_url;
```

| Role       | Detected from                                      |
| ---------- | -------------------------------------------------- |
| Raster URL | `raster_url`, `cog_url`, `cog`, `asset_href`, `href` |

::: warning This role is autodetect-only
`rasterUrl` has no entry in the Field mapping editor, for the same reason the four velocity roles
have none: it never reaches kepler as a column. Alias it in the query if your column is named
something else.
:::

## The query returns an address, not rows

Everything else on these pages draws your rows. This one draws a **file the browser was told where
to find**, so the panel makes a second dataset — `grafana-<refId>-raster` — that holds no rows at
all: only where the imagery is and which server should read it.

Your rows are not thrown away. The same query still becomes the ordinary table dataset it would have
been, which is usually worth having: a catalogue search returns a scene id, a date and a cloud cover
alongside the URL, and there is no reason to lose those because one of the columns happens to be an
image.

## Something has to read the file

A COG is not a tile source. It is one large GeoTIFF, organised so that a reader can fetch just the
part it needs — and something has to do that fetching and hand back tiles. That is the **[Raster tile
server](../../reference/panel-options)** panel option, pointing at a TiTiler-compatible service.

It reads the imagery **on the map's behalf**, which has one consequence worth stating plainly: the
server is what must be able to reach the file, not the browser. A raster in a private bucket needs a
tile server that can see that bucket — which is to say, one of your own.

The option defaults to `https://titiler.xyz`, Development Seed's public demo, and that default is
there so a freshly installed plugin draws a **public** COG without being configured first. Its limits
are real:

- it can only read imagery that is public;
- it is handed the URL you point it at, **signature and all**;
- it is a demo endpoint, with the availability that implies.

Anything private, or anything you depend on, wants a server of your own. Under a strict CSP it is
the **tile server's** host that needs a `connect-src` entry — the bucket is never contacted by the
browser. See [Install](../install#hardened-grafana).

## Colour

kepler's default ramp is `cfastie`, which was built for drone NDVI and **is not monotonic**: it
steps through black, grey, white, green, yellow, red and magenta. On a continuous field — rainfall,
temperature, an index — neighbouring cells of similar value land on unrelated colours and the map
reads as confetti rather than as a field.

The **Raster colour ramp** panel option imposes one instead, applied to rasters your queries
produce: `blues`, `greens`, `reds`, `viridis`, `magma`, `greys`, and two diverging ramps. Left
empty, nothing is imposed and kepler's default stands.

It applies to a **single-band** raster, which is the case where a ramp is used at all. A three-band
true-colour scene is drawn from its own bands and ignores the setting — kepler works out which is
which from the STAC metadata the tile server emits, and falls back to the band descriptions when
`common_name` is absent, which is what TiTiler gives it.

Two more things about it:

- It is applied **once per layer**, when the layer appears. After that the ramp is yours: change it
  in kepler's layer panel and the panel will not put its own back over your choice.
- It does nothing to a **PMTiles** archive, which has no ramp to set, nor to a raster the
  [tile server paints](#painted), which has its own palette.

## A classified raster: let the server paint {#painted}

Everything above assumes the colours are a **choice** — a ramp over measurements, yours to change.
For a classified raster they are not. Land cover, soil types, an ecoregion map: the pixel values are
class numbers, and the file usually carries the one correct palette inside it as a colour table.

kepler cannot draw that. It asks the tile server for **raw arrays** (`.npy`) and colours them in a
shader, and the shader rescales the values over the whole range of their data type. Measured on the
nine-class Impact Observatory land-cover COG, whose classes are numbered 1 to 11 in a `uint8`: every
class lands in the same slot of the 256-entry colour texture, and the map draws **one flat slab**.
Its categorical mode does not rescue it — the class values collide there too, and passing them
unshifted overflows the texture outright.

The **Let the tile server paint** panel option takes the drawing away from the browser. Tiles are
requested as `.png` from the same server, which opens the file, reads the colour table it carries and
returns a finished picture. Nine classes, nine colours, the ones the publisher chose.

```sql
-- Nothing about the query changes: it still returns an address.
SELECT 'https://example.org/landcover/2023.tif' AS raster_url
```

The cost is the PMTiles cost, and for the same reason — what arrives is already drawn:

- The layer panel offers **opacity** and nothing else. No ramp, no rescaling, no picking a band.
- The **Raster colour ramp** option does nothing here. The file's own palette is the point.

Everything else is unchanged: a series of dated rows still becomes a timeline, and moving the window
still swaps the picture in place without rebuilding the layer.

Leave it **off** for imagery. A true-colour scene wants its stretch decided where you can see it.

::: tip One file, one footprint
Classified rasters are often published cut into tiles of a grid — the land-cover collection above is
one COG per UTM zone, 6° by 8°. A map showing more than one zone needs **one query per file**, each
in its own `refId`, and each becomes its own layer. Tiles outside a given file's footprint are
answered 404 by the server and simply not drawn, which is what makes the layers stack cleanly.
:::

## Or no server at all: PMTiles {#pmtiles}

If the URL **contains** `.pmtiles` — `contains`, not `ends with`, so a signed link carrying a query
string of its own still counts — the panel takes a different path entirely: kepler reads the archive
itself, over range requests, and no tile server is involved — the panel option is ignored, and can
be left empty. All the file needs is somewhere static to be fetched from, with CORS and byte ranges.
Here it **is** the archive's own host that needs the `connect-src` entry.

That is the answer for an install with nowhere to run a server, and it costs exactly one thing: a
PMTiles archive holds **pictures**, not measurements, so the colours were decided when it was built.
The layer panel offers opacity and nothing else — no ramp, no rescaling, no picking a band. A COG
keeps its numbers and can be restyled live; an archive cannot.

Which of the two a query means is read off its **URL**, not configured, so a dashboard can hold both
kinds at once and a COG with no server configured is discarded on its own without taking the archive
beside it down with it.

## Where the scene comes from

The address does not have to be fixed. STAC catalogues answer over plain HTTP, so a data source that
can make an HTTP call can search one and return today's best scene — which is what makes the imagery
follow the dashboard rather than sit still on it.

Searching one from DuckDB, with the `http_client` community extension. `http_get` is an ordinary
scalar function, so the URL is built by concatenation and the dashboard's range goes straight into
it:

```sql
WITH resp AS (
  SELECT http_get(
    'https://earth-search.aws.element84.com/v1/search'
    || '?collections=sentinel-2-l2a'
    || '&bbox=-79.10,-3.05,-78.90,-2.85'
    || '&datetime=' || $__timeFrom() || '/' || $__timeTo()
    || '&limit=100'
  ) AS r
),
features AS (
  SELECT unnest(json_extract(r->>'body', '$.features[*]')) AS f FROM resp
)
SELECT f->'assets'->'visual'->>'href' AS raster_url
FROM features
WHERE (f->'properties'->>'eo:cloud_cover')::DOUBLE < 60
ORDER BY (f->'properties'->>'datetime')::TIMESTAMP DESC
LIMIT 1;
```

Moving the dashboard's time range now changes the imagery — without moving the frame you are looking
at, and without re-styling the layer. A re-run that resolves to the same scene changes nothing at
all, so an auto-refresh does not blink.

A range with **no scene** under the threshold returns no rows, and the raster leaves the map with
them: showing the previous scene would be showing imagery from outside the range as though it
belonged to it.

Return **one row per date** instead of one row, and the query stops being an answer and becomes a
small catalogue the map's time widget can walk. See [Imagery over time](./imagery-over-time).

## What is saved, and what is rebuilt

The raster dataset is rebuilt by the query on every load, so — unlike a tileset you add by hand in
kepler's own panel — it is **not** written into the dashboard JSON, and there is nothing to save.
Its layer is, with whatever you styled on it. See
[Map configuration](../map/map-configuration).

## Three ways this fails without saying so

::: warning kepler cannot draw a float32 raster
It looks up a maximum value per data type to rescale against, has none for the float types, and
gives up. The result is a layer that requests no tiles, draws nothing, and reports nothing. `uint8`
draws, but flat. **`uint16` is what works**, so a raster you compute yourself has to be scaled onto
it — see [Measuring imagery](../sources/measuring-imagery).
:::

::: warning A strict CSP needs `connect-src`, not `img-src`
Tiles arrive as arrays fetched over XHR, not as images pointed at by an `<img>`, so the obvious
directive is the wrong one. The symptom is a map that draws nothing, silently, with no CSP message
about images.
:::

::: warning Rejected metadata is silent
If the tile server's STAC document is not one kepler accepts, kepler swallows the exception and
keeps the metadata it had — leaving an empty layer and no error. Check it from the browser console:
`metadata.stac_version` on the dataset should be a version string, not `undefined`.
:::

## The raster can be one you computed

`raster_url` is just a link, so it can point at a raster **your own query wrote**. Computing an
index in SQL and drawing the result goes through this same path — the panel cannot tell it from a
Sentinel scene. Getting numbers *out* of a raster is the other half, and needs no file at all.

Both are on [Measuring imagery](../sources/measuring-imagery).
