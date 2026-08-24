# Layers a query cannot drive

kepler.gl 3.3.0-alpha.7 registers nineteen layer types. Thirteen are in [the gallery](./). The other
six are configured with a **URL** rather than with data, so a Grafana query cannot describe one the
way it describes a table of points.

One of the six is now an exception: a query that returns a link to a cloud-optimised GeoTIFF **does**
produce a `rasterTile` layer. See [From a query: rasters](#from-a-query-rasters) below. The rest are
still added by hand.

| Layer        | What it takes                                                        | deck.gl layer            |
| ------------ | -------------------------------------------------------------------- | ------------------------ |
| `vectorTile` | an MVT tile endpoint or a `tiles.json`                               | `MVTLayer` / `TileLayer` |
| `rasterTile` | a raster tile endpoint, or STAC metadata — **or a query, see below** | `TileLayer`              |
| `wms`        | a WMS service URL                                                    | `WMSLayer`               |
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
`href`) and the panel builds a raster dataset from the first row and lets kepler draw it.

Two pieces make it work:

- the **[Raster tile server](../reference/panel-options)** panel option, pointing at a
  TiTiler-compatible service. A COG is not a tile source by itself: something has to read the parts
  of it the map is showing and hand back tiles. That service reads the imagery on the map's behalf,
  which is why it — not the browser — is what must be able to reach it, and why a private raster
  needs a server of your own;
- a catalogue query, if the scene is not fixed. STAC catalogues answer over plain HTTP, so a data
  source that can make an HTTP call can search one and return today's best scene.

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

## Base maps are a different thing

Do not reach for `rasterTile` or `vectorTile` to change the background. The base map is a **panel
option** with its own list, including self-hosting a MapLibre `style.json` for an air-gapped
install — and it is rendered by MapLibre underneath deck.gl rather than as a deck.gl layer.

See [Base maps and relief](../guide/map/basemaps-and-relief).
