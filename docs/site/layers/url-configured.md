# Layers configured with a URL

kepler.gl 3.3.0-alpha.21 registers twenty-six layer types. Nineteen draw rows: thirteen are in [the
gallery](./), three more have sections of their own — `a5` and `geohash`, kepler's other two
grid-index layers, in [Geometry and spatial indices](./geometry-and-indices#geohash), and kepler's
`flowField` in [Velocity fields](./velocity-fields#kepler-flow-field) — and three are new in the
3.3.0 line, `contour` and `voronoi` (3.3.0-alpha.20) and `donut` (3.3.0-alpha.21), which take points
like the aggregation layers. The other seven are
configured with a **URL** rather than with data, so a Grafana query cannot describe one the way it
describes a table of points.

Three of the seven are exceptions now, and they are covered elsewhere: a query that returns a link
to a cloud-optimised GeoTIFF produces a `rasterTile` layer, one that names a WMS service produces a
`wms` layer, and one that names a Zarr store produces the panel's own `zarrTiles` layer, drawn
through a tile server rather than by kepler's `zarr`. See
[Satellite imagery and other rasters](../guide/data/rasters), [WMS services](../guide/data/wms) and
[Zarr stores](../guide/data/zarr). This page is about the four that are still added by hand — and
about adding any of the seven by hand, which stays possible whatever your query does.

| Layer                       | What it takes                                                          | deck.gl layer            |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| [`vectorTile`](#vectortile) | an MVT tile endpoint or a `.pmtiles` archive                           | `MVTLayer` / `TileLayer` |
| `rasterTile`                | a raster tile endpoint, or STAC metadata — **or a query**              | `TileLayer`              |
| `wms`                       | a WMS service URL — **or a query**                                     | `WMSLayer`               |
| [`tile3d`](#tile3d)         | a 3D Tiles, I3S, Google or Cesium ion endpoint                         | `Tile3DLayer`            |
| [`bitmap`](#bitmap)         | one image plus its west, south, east and north bounds                  | `BitmapLayer`            |
| [`3D`](#model)              | a glTF model, placed at each row of a dataset                          | `ScenegraphLayer`        |
| [`zarr`](#zarr)             | a Zarr store URL, read in the browser — **or a query**, as `zarrTiles` | `deck.gl-zarr`           |

## Why the other four are out of scope

A Grafana panel's input is a **table of rows**. These layers do not have one: their content lives at
a URL that the browser fetches directly, and the only thing a query could contribute is the URL
itself.

Which, for imagery, turned out to be enough — hence the three exceptions. It is not enough for a 3D
model or a pair of corner coordinates, where the layer needs describing rather than locating.

They are also why the plugin's own layer gallery dashboard stops at thirteen. Demonstrating them
would mean calling a third-party tile service on every dashboard load, which contradicts the
premise that the plugin makes no outbound call to any vendor.

## Using them anyway

Nothing stops you. All but `3D` come from **Add Data → Tileset** in kepler's own panel — Vector
Tile, Raster Tile, WMS, 3D Tile, Bitmap and Zarr: pick the type, give it a URL, and kepler creates
the dataset and its layer together. `3D` is the odd one out — it is an ordinary layer over a point
dataset, so it takes its model in the layer's own settings. Either way the result sits alongside the
layers your queries produce, which is a genuinely useful arrangement — your own data over your
organisation's basemap tiles, say.

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

::: tip A COG pasted by hand is read by the panel's raster tile server
The form's **Raster tile servers** field starts from the panel's **Raster tile server** option. A
Cloud Optimized GeoTIFF's description is asked of the first server in that field, as
`<server>/cog/stac?url=<cog>` (TiTiler's STAC extension), and the tileset keeps those servers for its
tiles. With no server in the field the form asks no one, and says that a COG needs a server: set
the panel option, or type one in the field. Up to 1.6 the form sent every COG to Development Seed's
public demo, `https://titiler.xyz`, whatever the option said, as kepler's own form does. A query
does not go through this form and is unaffected.
:::

## vectorTile {#vectortile}

![A vector tile layer drawing a PMTiles archive](/img/layer-vector-tile.jpg)

Polygons, lines and points cut into tiles: an MVT endpoint (`…/{z}/{x}/{y}.pbf`) or a PMTiles
archive, which needs no tile server. The image is the New Zealand buildings archive, one of the
examples kepler's form offers.

**Add Data → Tileset → Vector Tile** asks for a name, the **Tileset URL** — with `{x}`, `{y}` and
`{z}` placeholders, or a `.pmtiles` extension — and an optional **Tileset metadata URL** (JSON or
text), which is where kepler learns the features' properties. For a `.pmtiles` URL the archive is
its own metadata. A PMTiles archive of **raster** tiles is refused here; it belongs in the Raster
Tile form.

The layer colours the fill by a property, with **Dynamic Color** to fit the colour scale to what is
in view; outlines, their colour and width by a property; points sized in pixels or metres; height by
a property in 3D; and **Hide Null Values** to drop features with no value for the fill instead of
showing them grey. Hovering shows the feature's properties.

A filter on a vector tile dataset is applied on the GPU, so kepler's filter panel offers only its
numeric and boolean properties. kepler records that when the tileset is added but does not save it;
the panel puts it back when it restores a saved map.

kepler adds no key or header of its own to the tile requests: a server that needs a key must take
it in the URL, which is then saved in the dashboard (see the warning above).

## tile3d {#tile3d}

![A 3D Tiles mesh on the ground](/img/layer-tile3d.jpg)

A 3D tileset: a photogrammetric mesh, a city model, a point cloud. kepler reads four kinds and picks
by the URL:

| The URL contains | Read as                               | Token                     |
| ---------------- | ------------------------------------- | ------------------------- |
| `google`         | Google Photorealistic 3D Tiles        | a Google API key          |
| `ion.cesium`     | a Cesium ion asset                    | a Cesium ion access token |
| `arcgis`         | an ArcGIS I3S scene layer             | —                         |
| anything else    | OGC 3D Tiles, from its `tileset.json` | —                         |

**Add Data → Tileset → 3D Tile** takes a name, the **Tileset URL** and an **Access Token (if
needed)**, with one example of each kind. The image is a public 3D Tiles mesh, drawn from its
`tileset.json`.

kepler's own settings are colour, opacity and point size; colour and point size apply to point
clouds. The panel adds a **Position** group:

| Setting               | Default | What it does                                                     |
| --------------------- | ------- | ---------------------------------------------------------------- |
| Sit on the ground     | on      | Brings the tileset's base down to the map's ground               |
| Height adjustment (m) | 0       | A trim on top, from −4000 to 4000 m, to lift or bury the tileset |

The map's ground is flat, at height 0, and a tileset states its geometry at its real altitude. A
mesh surveyed at 300 m would float 300 m up — and, worse, disappear from any close or tilted camera
with no error, because deck.gl culls the tiles it thinks are out of view. The panel puts the base on
the ground for that reason. A tileset of buildings round the whole world, like Cesium OSM Buildings,
is set down building by building instead.

The panel also lets the camera tilt to 85° rather than kepler's 60°, which a mesh seen from close
to the ground needs.

The first time a tileset loads, kepler moves the map to it — except for Google's. A saved map keeps
its own saved view instead.

Nothing in a tileset can be hovered: it shows no tooltip.

::: warning The access token is not saved with the map
Anyone who can read a dashboard can read its JSON, so saving the map leaves the **Access Token**
out, as kepler's own **Export map** does. The tileset's URL and name are saved; the token lasts for
the session: after a reload, a tileset that needs one draws only once it is added again through
**Add Data** with its token. A dashboard saved with a token by an earlier version still loads with it, and its
next save leaves the token out. A key written into the tileset's URL itself is part of the URL,
and is saved (see above).
:::

## bitmap {#bitmap}

![A bitmap layer over San Francisco](/img/layer-bitmap.jpg)

One picture stretched over a rectangle: a scanned map, a plan, a rendered overlay. **Add Data →
Tileset → Bitmap** takes a name, an **Image URL** or a file dropped on the form, and the rectangle's
**West**, **South**, **East** and **North** in degrees. The image above is deck.gl's sample map of
San Francisco's districts.

A dropped file can be PNG, JPEG, GIF, WebP or TIFF, up to 10 MB. It is read into the page as a
`data:` URL — and saved with the map like a URL, so the picture itself ends up inside the dashboard
JSON.

| Setting                                | Default | What it does                                                                           |
| -------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| Opacity                                | 1       |                                                                                        |
| Show Bounds                            | on      | Outlines the rectangle                                                                 |
| Drag corners to resize, center to move | off     | Edit the rectangle on the map                                                          |
| Align to map                           | off     | Click a point on the image, then where it belongs; two or more pairs set the rectangle |
| West, South, East, North               | —       | The rectangle, typed                                                                   |

The rectangle has no rotation: an image that is not north-up will not line up. The layer has no rows
and shows no tooltip.

## 3D {#model}

![The 3D layer's default model, at three points](/img/layer-3d-model.jpg)

A glTF model drawn at every row of a dataset — a query's points, for instance. kepler never creates
it by itself: choose **Add Layer → 3D**, the dataset, and its **Lat** and **Lng** columns (and
optionally an altitude), or a GeoJSON column instead.

The model is chosen in the layer's settings: Airplane, Airliner, VTOL, Glider, Helicopter, Bicycle,
Scooter, Car, Truck, Semitruck, Cargoship, Ducky — the default, in the image — or **Custom**, with a
URL of your own.

::: warning The models come from Foursquare's servers
The built-in models are downloaded from `studio-public-data.foursquare.com` when the layer draws. A
Grafana with no route to the internet draws nothing, and one with a Content-Security-Policy needs
that host in `connect-src`. A **Custom** model on your own network avoids the first; its host goes
in `connect-src` the same way.
:::

Size, rotation about each axis (**angle X**, **angle Y**, **angle Z**) and a colour (**Apply
color**) are settings of the layer, the same for every row: every model faces the same way. For
marks that turn by a column, use [Symbols](./symbols-and-markers#symbol); for a model at the head of
a moving trail, the [Trip layer](./time#trip).

## zarr {#zarr}

kepler's own Zarr layer reads a store in the browser, with no tile server: **Add Data → Tileset →
Zarr**, then the store URL. It is a different layer from the panel's `zarrTiles`, which a query
draws through a tile server. What each costs, and when to use which, is in [kepler's own Zarr layer,
in the browser](../guide/data/zarr#kepler-s-own-zarr-layer-in-the-browser).

## XYZ tiles

kepler's `rasterTile` reads PMTiles and STAC, not the plain `{z}/{x}/{y}` scheme most tile servers
publish. The panel adds a layer type for it, **XYZ tiles**: OpenStreetMap-style servers, ArcGIS
MapServer caches, radar overlays. `{-y}` (rows counted from the south) and `{s}` or `{a-c}`
subdomains are understood.

There is no form for it in **Add Data**. It comes from a converted Geomap XYZ or ArcGIS layer (see
[Coming from Geomap](../guide/coming-from-geomap)), or from a configuration pasted under **Import
configuration**, which names the template as a dataset and draws it with a layer:

```json
{
  "version": "v1",
  "config": {
    "visState": {
      "layers": [
        {
          "id": "seamarks",
          "type": "xyz-tiles",
          "config": { "dataId": "seamarks", "label": "Seamarks", "isVisible": true, "visConfig": { "opacity": 1 } }
        }
      ]
    }
  },
  "datasets": [
    {
      "version": "v1",
      "data": {
        "id": "seamarks",
        "label": "Seamarks",
        "type": "xyz-tiles",
        "metadata": { "url": "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", "maxZoom": 18 },
        "fields": [],
        "allData": []
      }
    }
  ]
}
```

The two warnings above apply: the template is saved in the dashboard, and a hardened Grafana needs
the tile host in its Content Security Policy (`img-src` here, as the tiles are images). The tile
server's attribution is not shown on the map; credit it in the panel's description where its terms
ask for it.

## Base maps are a different thing

Do not reach for `rasterTile` or `vectorTile` to change the background. The base map is a **panel
option** with its own list, including self-hosting a MapLibre `style.json` for an air-gapped
install — and it is rendered by MapLibre underneath deck.gl rather than as a deck.gl layer.

See [Base maps and relief](../guide/map/basemaps-and-relief).
