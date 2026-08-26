# Layers a query cannot drive

kepler.gl 3.3.0-alpha.7 registers nineteen layer types. Thirteen are in [the gallery](./). The other
six are configured with a **URL** rather than with data, so a Grafana query cannot describe one the
way it describes a table of points.

Two of the six are now exceptions. A query that returns a link to a cloud-optimised GeoTIFF **does**
produce a `rasterTile` layer, and one that names a WMS service produces a `wms` layer — with a
timeline, if the service publishes one. See [From a query: rasters](#from-a-query-rasters) and
[From a query: a WMS](#from-a-query-wms) below. The rest are still added by hand.

| Layer        | What it takes                                                        | deck.gl layer            |
| ------------ | -------------------------------------------------------------------- | ------------------------ |
| `vectorTile` | an MVT tile endpoint or a `tiles.json`                               | `MVTLayer` / `TileLayer` |
| `rasterTile` | a raster tile endpoint, or STAC metadata — **or a query, see below** | `TileLayer`              |
| `wms`        | a WMS service URL — **or a query, see below**                        | `WMSLayer`               |
| `tile3d`     | a 3D Tiles / Cesium ion endpoint                                     | `Tile3DLayer`            |
| `bitmap`     | one image plus its corner coordinates                                | `BitmapLayer`            |
| `3D`         | a glTF model URL                                                     | `ScenegraphLayer`        |

## Why they are out of scope

A Grafana panel's input is a **table of rows**. These layers do not have one: their content lives at
a URL that the browser fetches directly, and the only thing a query could contribute is the URL
itself.

Which, for imagery, turns out to be enough — hence the exception below.

They are also why the plugin's own layer gallery dashboard stops at thirteen. Demonstrating them
would mean calling a third-party tile service on every dashboard load, which contradicts the
premise that the plugin makes no outbound call to any vendor.

## Using them anyway

Nothing stops you. The first five in the table come from **Add Data → Tileset** in kepler's own
panel: pick the type, give it a URL, and kepler creates the dataset and its layer together. `3D` is
the odd one out — it is an ordinary layer over a point dataset, so it takes its model URL in the
layer's own settings. Either way the result sits alongside the layers your queries produce, which
is a genuinely useful arrangement — your own data over your organisation's basemap tiles, say.

Three things to plan for.

::: warning It is not saved until you save it
Adding the tileset is not enough. Go back to **Map configuration → Save current map** in the panel
options, or the layer is gone the moment the panel is rebuilt — returning to the dashboard from the
editor is enough to do it.

The save stores the tileset's **descriptor**, not its data: its name, field list and URLs, a few
lines of JSON. On the next load the panel hands that back to kepler alongside your query results,
which is what re-creates the layer. See [Map configuration](../guide/map/map-configuration).
:::

::: warning A hardened Grafana will block the fetch
These layers fetch over XHR, so they fall under `connect-src`. With
`content_security_policy = true` you need the tile host in
`content_security_policy_template`, exactly as for a base map:

```ini
content_security_policy_template = """… connect-src 'self' grafana.com https://tiles.yourorg.internal …;"""
```

See [Install](../guide/install#hardened-grafana).
:::

**The URL is stored in the dashboard JSON.** It travels with the dashboard, including to anyone you
share it with, and any token embedded in it travels too. Prefer an endpoint that authenticates by
network position or by a reverse proxy over one that carries a key in the query string.

## From a query: rasters {#from-a-query-rasters}

A satellite scene is a file in a bucket, and its address is a string like any other — so a query
**can** hand one over. Return a column named `raster_url` (or `cog_url`, `cog`, `asset_href`,
`href`) and the panel builds a raster dataset from it and lets kepler draw it.

Return **one row per date** and the query stops being an answer and becomes a small catalogue: the
map's time widget shows a bar per capture and draws the most recent scene inside the window you
select. Dragging it costs nothing — the series is already in the browser — and it is the natural way
to walk a multitemporal collection. The scene changes on the layer itself, which keeps whatever you
styled and named on it, and the previous image stays on screen until the new one has drawn. See [Field roles](../reference/field-roles#the-raster-role-makes-a-second-dataset).

Two pieces make it work:

- the **[Raster tile server](../reference/panel-options)** panel option, pointing at a
  TiTiler-compatible service. A COG is not a tile source by itself: something has to read the parts
  of it the map is showing and hand back tiles. That service reads the imagery on the map's behalf,
  which is why it — not the browser — is what must be able to reach it, and why a private raster
  needs a server of your own. The option defaults to `https://titiler.xyz`, Development Seed's
  public demo, which is enough to draw a **public** COG out of the box — and is handed the URL you
  give it, signature and all, so anything private wants a server of your own;
- a catalogue query, if the scene is not fixed. STAC catalogues answer over plain HTTP, so a data
  source that can make an HTTP call can search one and return today's best scene.

### Or no server at all: PMTiles {#pmtiles}

If the URL ends in `.pmtiles` the panel takes a different path entirely: kepler reads the archive
itself, over range requests, and no tile server is involved — the panel option is ignored, and can
be left empty. All the file needs is somewhere static to be fetched from, with CORS and byte ranges.

That is the answer for an install with nowhere to run a server, and it costs exactly one thing: a
PMTiles archive holds **pictures**, not measurements, so the colours were decided when it was built.
The layer panel offers opacity and nothing else — no ramp, no rescaling, no picking a band. A COG
keeps its numbers and can be restyled live; an archive cannot.

Everything else is the same, bar one detail of how the scene changes. One row per date still makes a
series the time widget walks; a COG re-points the layer it is already drawing, while an archive
rebuilds it — kepler's PMTiles path gives deck.gl no way to learn that its tiles have expired, so
re-pointing one would leave the first date on screen for every date after it. In practice that costs
a fresh tile source per scene and nothing else. A dashboard can hold both kinds at once: which one a
query means is read off its URL, not configured.

The point of doing it this way is that **the raster follows the dashboard**. Parameterise the search
by `$__timeFrom()`/`$__timeTo()` and moving the time range changes the imagery, without moving the
frame you are looking at and without re-styling the layer. A re-run that resolves to the same scene
changes nothing at all — no blink on the auto-refresh.

The raster dataset is rebuilt by the query on every load, so — unlike a tileset added by hand — it
is **not** written into the dashboard JSON, and there is nothing to save. Its layer is, with
whatever you styled on it.

Searching a STAC catalogue from DuckDB, with the `http_client` community extension — `http_get` is
an ordinary scalar function, so the URL is built by concatenation and the dashboard's range goes
straight into it:

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

A range with no scene under the threshold returns no rows, and the raster leaves the map with them:
showing the previous scene would be showing imagery from outside the range as though it belonged
to it.

### The raster does not have to be someone else's

`raster_url` is just a link, so it can point at a raster **your own query computed**. DuckDB's
`raster` community extension reads and writes GeoTIFFs in SQL, which closes the loop: compute an
index from two bands, write it as a COG, and the panel draws it through the same path as a Sentinel
scene — it cannot tell the difference.

```sql
COPY (
  SELECT r.geometry,
         RT_Cube2TypeUInt16(((n.databand_1 - r.databand_1) / (n.databand_1 + r.databand_1)
                             + 0.2) / 1.1 * 65535.0) AS ndvi
  FROM RT_Read('red.tif') r JOIN RT_Read('nir.tif') n ON r.id = n.id)
TO 'ndvi.tif'
WITH (FORMAT RASTER, DRIVER 'COG', SRS 'EPSG:4326',
      DATABAND_COLUMNS ['ndvi'], CREATION_OPTIONS ('COMPRESS=DEFLATE'));
```

Three things about that are worth knowing before you spend an afternoon on them:

- **Write an integer type.** kepler cannot draw a `float32` raster: it looks up a maximum value per
  data type to rescale against, has none for the float types, and gives up — leaving a layer that
  renders nothing and reports nothing. `uint8` draws, but flat. `uint16` is what works, so scale
  your index onto it, as above.
- **The tile server has to be able to read the file.** It reads on the map's behalf, so a raster
  written to a path only the database can see is invisible to everyone. Share the directory, or
  write to object storage both can reach.
- **Materialising is not a query.** It writes a file, and a dashboard refreshing every 30 seconds
  must not redo it. Give the output a deterministic name — scene plus formula — compute it once,
  and let the panels read what is there. Writing to a name that already exists fails anyway.

Statistics are the other half, and they need no file at all: a TiTiler-compatible server answers
`/cog/statistics` for a whole scene or, with a GeoJSON in the body, for one polygon — which the
Infinity data source can call directly. Inside the database, `RT_CubeClip` plus `RT_CubeStats_Agg`
with a `GROUP BY` does the same for _every_ zone in one query, joined to your own tables. That is
the one thing the tile server cannot do, and it is what makes four thousand polygons a query rather
than four thousand HTTP requests.

## From a query: a WMS, with its clock {#from-a-query-wms}

A WMS is not a file: it is a service that draws pictures on demand. So the query hands over an
address and a name rather than data — a column named `wms_url` (or `wms`, `service_url`) and one
named `wms_layer` (or `layer`, `layer_name`) — and the panel builds the dataset and its layer.

Give it the **bare endpoint**, without a query string:
`https://services.geoglows.org/geoserver/satellite_based_precipitation/wms`. A whole `GetMap` URL
pasted in is trimmed back to that, deliberately: every request is built by appending parameters to
what you give, so anything after a `?` would end up merged into the first parameter and the server
would answer with a parse error about a date it was never sent.

Nothing else is needed. There is no tile server to configure — that is the difference between this
and a COG, and the reason a WMS works on a Grafana with no infrastructure behind it at all. The
**Raster tile server** option plays no part here.

### The timeline comes from whoever knows the dates

Many environmental services publish one image per day or per hour and expect a `TIME` on the
request. The map's time widget walks those dates, and they can come from either side:

- **From the query.** Return one row per date, alongside the service and layer, and those dates are
  the timeline. Use this when you want a subset, or a calendar assembled from somewhere else.
- **From the service.** Return no time column at all, and the panel reads the layer's
  `<Dimension name="time">` out of the service's own `GetCapabilities`. This is the one that keeps
  working by itself: a server gains a new pass every day and no hand-written calendar stays in step
  with it.

The query wins when both exist. Either way the dates become a small dataset of their own — kepler's
time filter is always a filter on a column, so the calendar has to be on the map for the widget to
exist — and you will see it in the data table beside your own rows.

Dragging the widget then costs one image. The date travels as a parameter on the next `GetMap`; no
query is re-run, no dataset is rebuilt, the layer you styled is the same layer throughout, and a
drag that stays between two dates asks for nothing at all. A window containing no date hides the
layer rather than dropping it, so playback can cross a gap and come back with your styling intact.

### What to expect of the service

- **CORS.** The browser fetches the pictures, so the service has to allow it. This is not the COG
  arrangement, where a server in the middle does the reading.
- **A strict CSP** needs the host in `connect-src`, **not** `img-src`. A WMS image is fetched and
  parsed as data rather than pointed at by an `<img>`, so the obvious directive is the wrong one —
  and the symptom is a map that draws nothing, silently, with no CSP message about images.
- **The capabilities document** is read once per service per page load, and it can be large: nearly
  a megabyte on GeoGLOWS, whose hourly layers list fourteen thousand dates. An extent longer than
  two thousand instants keeps its newest end.
- **A date the service does not have** comes back as an empty picture. That is why nothing is ever
  guessed: with no calendar from either side, no `TIME` is sent and the service answers with its own
  default.

### Clicking asks the service

A WMS carries no rows, so the only way to know what is under a pixel is to ask the server —
`GetFeatureInfo`, which is what a click does on a queryable layer. kepler shows the answer in its
popover, and a **click mapping** on the field `wms_value` sends it to a dashboard variable, so the
panels around the map can read it.

`wms_value` is the first value the service returned, under a name that is the same everywhere. The
attributes also arrive under their own names — both as the service spells them (`GRAY_INDEX`) and as
kepler displays them (`GRAY INDEX`) — for a vector WMS returning several.

The question carries the date on screen, so the answer is about the image you are looking at rather
than the service's default. And it is the service's answer verbatim: a sentinel like `-99` means
*no data here*, not a failure.

### Reading the same data instead of drawing it

A WMS hands out pictures, which is a wall for anything you want to *compute*. But a GeoServer that
publishes a WMS usually publishes a **WCS** over the same coverage — the same scene, delivered as
pixels rather than as a rendering — and that turns the map's imagery into something a query can work
on. No second source, no ETL.

With the `raster` DuckDB extension, one query reads a window of it over HTTP and cuts it to a
polygon:

```sql
INSTALL raster FROM community; LOAD raster;
SELECT RT_GdalConfig('CURL_CA_BUNDLE', '/etc/ssl/certs/ca-certificates.crt');
SET VARIABLE cobertura = '/vsicurl/<service>/wcs?service=WCS&version=2.0.1&request=GetCoverage&…';
SELECT RT_CubeStats_Agg(RT_CubeClip(databand_1, tile_x, tile_y, metadata, ST_GeomFromText($area), -99.0), 0)
FROM RT_Read(getvariable('cobertura'));
```

`$area` is the polygon the map publishes when you draw one, so the number follows the shape on
screen. Five things are worth knowing before you write your own:

- **`RT_Read` needs a literal path**, so the URL is assembled into a variable and read back with
  `getvariable()`. The data source runs multi-statement scripts and returns the last one's result,
  which is what makes this a single panel query.
- **Ask the service which date it has.** Deriving one from the dashboard range gives a 404 the day
  the range runs ahead of the last pass — the same `GetCapabilities` the map reads answers this.
- **The band index is zero-based.** `RT_CubeStats(cube, 1)` on a one-band coverage fails with
  `Band index out of range`.
- **Do not set the nodata value.** The GeoTIFF declares its own and the aggregate honours it;
  overwriting it with `RT_CubeSetNoData` returned negative minima for a rainfall product — the clip's
  fill value is enough, and a fill equal to the service's own sentinel is discarded automatically.
- **The request happens on the Grafana server**, not in the browser, so CORS and CSP have nothing to
  do with it — but the server is what must be able to reach the service.

The output is a table, which is what a Grafana panel eats. Nothing here goes back to the map: the
imagery is still drawn as imagery, and what travels is an aggregate.

## Base maps are a different thing

Do not reach for `rasterTile` or `vectorTile` to change the background. The base map is a **panel
option** with its own list, including self-hosting a MapLibre `style.json` for an air-gapped
install — and it is rendered by MapLibre underneath deck.gl rather than as a deck.gl layer.

See [Base maps and relief](../guide/map/basemaps-and-relief).
