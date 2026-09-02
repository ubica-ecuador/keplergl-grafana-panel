# Layers configured with a URL

kepler.gl 3.3.0-alpha.9 registers twenty-one layer types. Thirteen are in [the gallery](./), and two
more — `a5` and `geohash`, kepler's other two grid-index layers — the panel does not detect from a
column, so they are added by hand like the ones below. The other six are configured with a **URL**
rather than with data, so a Grafana query cannot describe one the way it describes a table of
points.

Two of the six are exceptions now, and they are covered elsewhere: a query that returns a link to a
cloud-optimised GeoTIFF produces a `rasterTile` layer, and one that names a WMS service produces a
`wms` layer. See [Satellite imagery and other rasters](../guide/data/rasters) and
[WMS services](../guide/data/wms). This page is about the four that are still added by hand — and
about adding any of the six by hand, which stays possible whatever your query does.

| Layer        | What it takes                                                        | deck.gl layer            |
| ------------ | -------------------------------------------------------------------- | ------------------------ |
| `vectorTile` | an MVT tile endpoint or a `tiles.json`                               | `MVTLayer` / `TileLayer` |
| `rasterTile` | a raster tile endpoint, or STAC metadata — **or a query**            | `TileLayer`              |
| `wms`        | a WMS service URL — **or a query**                                   | `WMSLayer`               |
| `tile3d`     | a 3D Tiles / Cesium ion endpoint                                     | `Tile3DLayer`            |
| `bitmap`     | one image plus its corner coordinates                                | `BitmapLayer`            |
| `3D`         | a glTF model URL                                                     | `ScenegraphLayer`        |

## Why the other four are out of scope

A Grafana panel's input is a **table of rows**. These layers do not have one: their content lives at
a URL that the browser fetches directly, and the only thing a query could contribute is the URL
itself.

Which, for imagery, turned out to be enough — hence the two exceptions. It is not enough for a 3D
model or a pair of corner coordinates, where the layer needs describing rather than locating.

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

That last point is the sharpest difference between adding a raster by hand and letting a query
return one. A tileset added by hand is written into the dashboard; a raster a query produces is
rebuilt from the query on every load and never saved, so it is the query — with whatever
authentication the data source already has — that decides what is reachable.

::: tip Pasting a COG by hand takes the STAC URL, not the file
kepler decides a URL is a COG by looking at its path, and then wires its own public tile server for
both the metadata and the tiles — ignoring the **Raster tile server** panel option entirely. To use
your own server from this form, paste the STAC URL it exposes, `<server>/cog/stac?url=<cog>`, whose
path does not trigger that branch. A query does not go through this form and is unaffected.
:::

## Base maps are a different thing

Do not reach for `rasterTile` or `vectorTile` to change the background. The base map is a **panel
option** with its own list, including self-hosting a MapLibre `style.json` for an air-gapped
install — and it is rendered by MapLibre underneath deck.gl rather than as a deck.gl layer.

See [Base maps and relief](../guide/map/basemaps-and-relief).
