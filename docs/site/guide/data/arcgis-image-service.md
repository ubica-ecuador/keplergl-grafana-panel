# ArcGIS Image Services

A query that returns the URL of an ArcGIS **Image Service** produces an `esriImage` layer: one layer
that covers the whole world, at any zoom, with no file to prepare and no tile server of your own.

```sql
SELECT 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer'
         AS esri_url
```

<video src="/img/guide-arcgis-image-service.mp4" poster="/img/guide-arcgis-image-service.jpg" autoplay loop muted playsinline controls aria-label="The Sentinel-2 land-cover Image Service drawn in the panel: panning and zooming redraws it at any extent, and the class composition beside the map follows the view" style="width:100%;height:auto;border-radius:8px"></video>

## Why this exists beside the raster path

[A raster](./rasters) is a **file**, and a file has one footprint. Global collections are published cut
into a grid — the Sentinel-2 land-cover product is one cloud-optimised GeoTIFF per UTM zone, 6° of
longitude by 8° of latitude, about 200 of them per year — so covering a country takes several queries
and covering the world is out of the question.

An Image Service is not a file. It is a **mosaic dataset**: the catalogue of those same rasters, a
rule for choosing among them, and a pyramid built once over the whole mosaic. Ask it for an extent
and it picks the sources, resamples them and returns a finished picture. One endpoint, any extent,
any zoom.

That is the whole difference, and it is worth being concrete about the size of it. Measured against
the public land-cover service, one 256-pixel tile:

| Zoom | Time |
| ---- | ---- |
| 8 (a province) | 1,15 s |
| 6 (a country) | 0,77 s |
| 3 (a continent) | 1,25 s |
| 1 (the world) | 1,35 s |

Flat, because every zoom reads the level of the pyramid built for it.

## Choosing what it draws

Two more columns, both optional, both the service's own JSON passed through untouched:

| Column | Aliases | What it does |
| ------ | ------- | ------------ |
| `esri_url` | `image_service_url`, `imageserver_url` | The endpoint, ending in `/ImageServer` |
| `mosaic_rule` | `esri_mosaic_rule` | Which rasters of the mosaic to draw |
| `rendering_rule` | `esri_rendering_rule` | How to draw them |

The **mosaic rule** is how a year is chosen on a multi-temporal service:

```sql
SELECT
  'https://…/Sentinel2_10m_LandCover/ImageServer'                            AS esri_url,
  '{"mosaicMethod":"esriMosaicAttribute","where":"Year=' || $anio || '"}'    AS mosaic_rule
```

Changing it does **not** rebuild the layer. It rides in the layer's `visConfig`, the way a Zarr
layer's time label does, so stepping through years keeps whatever you named, faded or reordered.
Only a change of endpoint or of rendering rule rebuilds.

Left out, the service draws with the renderer its author published — which for a thematic service is
the palette they chose, and the reason this path needs no colour settings at all.

::: warning The layer panel is bare, for now
kepler builds a layer's settings from a method named after its type and adds none for a type a plugin
contributes, so the panel shows the layer and its data source and nothing else — no opacity slider.
The same is true of the Zarr layer and the flow field. The layer does register an opacity setting for
a configurator to read; injecting one would fix all of them at once, and is not done yet. The eye
still switches the layer off.
:::

### Walking the years with the map's clock

A dashboard variable is one way to choose the year. The other is the map's own time widget: return
**one row per moment**, each with a `time` and the rule that draws it, and the clock walks them.

```sql
SELECT
  make_timestamp(anio, 1, 1, 0, 0, 0)                                        AS time,
  'https://…/Sentinel2_10m_LandCover/ImageServer'                            AS esri_url,
  '{"mosaicMethod":"esriMosaicAttribute","where":"Year=' || anio || '"}'     AS mosaic_rule
FROM generate_series(2017, 2023) AS t(anio)
```

The map opens on the newest moment in range and follows the window from there. It costs no query and
no rebuild: everything is already in the browser, the chosen rule lands in the layer's `visConfig`,
and only the tiles on screen are refetched. A drag that stays between two moments produces nothing.

This is cheaper than the same thing over files. A COG timeline swaps one image for another, and a
window with no scene has to hide the layer; a service holds every year behind one endpoint, so
moving through time is a change of parameter.

### Drawing only part of it

A service publishes named **raster functions**, and the rendering rule names one. They are the
service's own, listed under `rasterFunctionInfos` in its JSON description — the land-cover service
offers twelve, one per class plus a cartographic renderer.

```sql
SELECT
  'https://…/Sentinel2_10m_LandCover/ImageServer'                                  AS esri_url,
  '{"rasterFunction":"Isolate Converted Lands for Visualization and Analysis"}'    AS rendering_rule
```

Everything the function excludes comes back transparent, so the base map shows through and the layer
becomes a thematic overlay rather than a full coverage. Measured on one tile of coastal Ecuador:

| Rendering rule | Painted | Colours |
| -------------- | ------- | ------- |
| none | 100 % | 8 |
| Isolate Trees | 55,6 % | 1 |
| Isolate Converted Lands | 8,9 % | 2 |
| Isolate Built Areas | 2,0 % | 1 |

The default is already the service's cartographic renderer — asking for it explicitly changes
nothing, byte for byte — so leave the column out unless you want one of the others.

## What it costs

::: warning It is someone else's server
Every pan and zoom is a render request to a service you do not run. Public services are rate-limited
and can be withdrawn, the colours are theirs, and there is nothing to fall back on when the service
is down. For imagery you own, [a COG](./rasters) keeps working with nothing but a tile server, and
its numbers can be restyled live.
:::

::: tip The picture and the figures can agree by construction
An Image Service also answers `computeHistograms`, `getSamples` and the rest of its REST API. A
dashboard that draws the map from the service and computes its figures from the same service is
reading one source twice, so the two cannot drift apart. That is not true of a map drawn from one
copy of the data and figures computed from another.
:::

## Two things measured, so you do not have to find them

**`transparent=true` is not enough.** With `format=png` the service returns its nodata as **opaque
black** — half the area of a coastal tile — whatever the flag says. Only `png32` carries a real alpha
channel. The panel always asks for `png32`, so the sea stays clear and the base map shows through.

**The bounds go as metres, not degrees.** A tile is a square of Web Mercator and its extent in
degrees is not; sent as degrees the service reprojects a box whose edges do not line up with the
tile, and the picture arrives shifted further north-south the further you are from the equator. The
panel converts before asking.

## Asking what is under the click

The layer itself reports nothing on hover or click: what it receives is a picture, so there is
nothing under the cursor to read — the same limitation a PMTiles archive has.

A service, though, will answer that question directly, and no plugin code is needed to ask it. The
map already publishes the clicked coordinate to dashboard variables, and the service's `identify`
endpoint is an ordinary GET returning JSON, so an [Infinity](../sources/infinity) query closes the
loop:

1. Turn on kepler's **coordinate** interaction and add a mapping with `source: 'coordinate'`, its
   `variable` the latitude and its `variableTo` the longitude.
2. Point a panel at `<service>/identify` with `geometryType=esriGeometryPoint`, the clicked point as
   `geometry`, and the same `mosaicRule` the map is drawing.
3. Read `value` out of the reply. It is the raw class number; a Grafana **value mapping** turns it
   into a name and its official colour.

```
geometry     {"x":${lng:raw},"y":${lat:raw},"spatialReference":{"wkid":4326}}
geometryType esriGeometryPoint
mosaicRule   {"mosaicMethod":"esriMosaicAttribute","where":"Year=${anio:raw}"}
f            json
```

Verified against the land-cover service: Amazonia answers `2`, Guayaquil `7`, the open Pacific
`NoData`.

::: warning A text field needs naming
`value` comes back as a string — `NoData` is one of its answers — and a **stat** panel with
`reduceOptions.fields` left empty only looks at numeric fields, so it shows nothing at all. Name the
field explicitly, as `/^clase$/`. This is the same trap Infinity sets elsewhere in this repo.
:::

::: tip Sampling resolution
Esri's own viewer also sends `pixelSize`, matching the resolution being displayed, so the answer
describes the pixel you can see rather than the 10 m one underneath it. Left out — as above — the
service samples native resolution, which is more precise and rarely what you did not want.
:::
