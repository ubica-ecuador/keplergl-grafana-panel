# WMS services

A WMS is not a file: it is a service that draws pictures on demand. So the query hands over an
address and a name rather than data, and the panel builds the dataset and its layer.

```sql
SELECT 'https://services.geoglows.org/geoserver/satellite_based_precipitation/wms' AS wms_url,
       'persiann_pdir_24h' AS wms_layer;
```

| Role      | Detected from                      |
| --------- | ---------------------------------- |
| WMS URL   | `wms_url`, `wms`, `service_url`    |
| WMS layer | `wms_layer`, `layer`, `layer_name` |
| WMS box   | `tiles_bbox`, `wms_bbox`           |
| WMS style | `wms_style`, `wms_styles`          |
| Legend    | `legend_url`, `legend_graphic_url` |

The two go together: a service publishes many layers, so a URL without a layer name is not a
picture. **Both must be present or neither role applies.** Like the raster role, neither appears in
the Field mapping editor — alias them in the query if your columns are named otherwise.

<video src="/img/guide-rasters.mp4" poster="/img/guide-rasters.jpg" autoplay loop muted playsinline controls aria-label="The PERSIANN precipitation WMS on the map: dragging the time widget makes the service redraw the scene for each date, and the statistics beside it follow" style="width:100%;height:auto;border-radius:8px"></video>

## Where the layer is

A WMS draws whatever view it is asked for, so nothing in the service tells the map where its layer
has data. A third column can: the layer's box as text, `west south east north` in degrees, read from
the row that names the service and the layer.

```sql
SELECT 'https://data.geopf.fr/wms-r/wms' AS wms_url,
       'AN-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI' AS wms_layer,
       '-5.5 41 10 51.5' AS tiles_bbox;
```

Spaces between the numbers on purpose: kepler reads `[w,s,e,n]` or `w,s,e,n` in a column as a pair of
points and would draw it. A west greater than its east is a box across the antimeridian. With the
box, the panel does two things:

- **It frames the layer.** When the layer appears, or the query starts naming another, and the view
  shows none of the box — or the map has no saved view at all — the view moves onto the box. A saved
  view that shows any part of the layer is kept, and a refresh that brings the same layer back never
  moves the map.
- **It draws the picture only inside the box.** Many services paint opaque white wherever they have
  no data, whatever `TRANSPARENT` says — IGN's Cassini map is one — and the picture of the view
  covered the rest of the world in white. Outside the box nothing is drawn and a click asks the
  service nothing. On a globe the picture is drawn whole; on a relief base map, where the base map
  draws the layer as tiles, it asks for no tile outside the box but draws the edge tiles whole.

A query's `{z}/{x}/{y}` tiles (`tiles_url`) take the same box, in the same column, and get the same
two: the view framed on it, the tiles cut to it (see
[How a query becomes a map](./how-a-query-becomes-a-map#the-query-that-returns-an-address-instead-of-rows)).

## Styles and legends

A WMS layer often comes in several **styles**, which its capabilities list: the same warnings drawn
by type or by severity, a temperature as shaded classes or as contours. A fourth column picks one,
and a fifth says where its legend is:

```sql
SELECT 'https://maps.dwd.de/geoserver/ows' AS wms_url,
       'dwd:Autowarn_Analyse' AS wms_layer,
       'autowarn_analyse_severity' AS wms_style,
       'https://maps.dwd.de/geoserver/ows?service=WMS&version=1.3.0&request=GetLegendGraphic'
         || '&format=image%2Fpng&layer=dwd%3AAutowarn_Analyse&style=autowarn_analyse_severity'
         AS legend_url;
```

- **`wms_style`** is the `STYLES` of every request: the pictures (`GetMap`, and the tiles a relief base
  map draws) and the clicks (`GetFeatureInfo`), so a click is answered for the style on screen. Empty,
  or no column, is the service's default style. Read from the row that names the service and the
  layer. Not `style` alone: a table of buildings has a column called that about the building.
- **A change of style is a new picture, not a new layer.** A variable over the styles the catalogue
  lists, or the Spatial Catalog's style picker, changes the column; the map asks the service for the
  same view in the new style. The view does not move, and the layer keeps whatever was set on it in
  the layer panel (its name, its opacity, its place in the list).
- **The map's legend shows the legend of the style drawn.** Open it with the legend button in the
  map control (or save the map with it open: it is part of the saved configuration, see
  [Map settings](../kepler/map-settings#legend)). Under the layer's name it shows the `legend_url`
  picture when the row gives one (a WMS's `LegendURL`, most often a `GetLegendGraphic`); for a
  `wms_style` with no `legend_url`, the service's `GetLegendGraphic` of that style (`STYLE=`); for
  the default style with neither, the legend the capabilities publish, or the default
  `GetLegendGraphic`, as kepler does for any WMS. It changes with the style. The picture is shown as
  it is, on a white ground, and loads as an image, which needs no CORS; one that does not load leaves
  only the layer's name.
- **The row's `title` names the layer.** A row that carries a `title` (the Spatial Catalog gives each
  service its own) names the dataset and the layer, in the layer panel and in the legend, where the
  query's name would be the same for every service a catalog query lists. A layer you renamed in the
  layer panel and saved keeps your name.

An ArcGIS service's `legend_url` takes the same column, and its swatches are drawn in the same
legend: see [ArcGIS Image Services](./arcgis-image-service#its-legend).

A query's `{z}/{x}/{y}` picture tiles (`tiles_url`, a WMTS's tile matrices spelt as a template) take
the same `legend_url` too, a picture, shown under the layer's name in the same legend: a WMTS style's
`LegendURL`, which for GeoServer's GeoWebCache is the `GetLegendGraphic` of that style
(`…/ows?service=WMS&request=GetLegendGraphic&layer=dwd:Laender&style=Laender_ocker`). A WMTS's
other style is another template; when the frame names its layer (`meta.custom.layer.key`, as the
Spatial Catalog sends it) and the key stays, a change of style draws the new tiles and the new
legend on the same layer, and the view does not move. Vector tiles and archives take no `legend_url`:
kepler's legend shows what their layer is coloured by.

## Nothing sits in between

There is no tile server to configure here. That is the difference between a WMS and a COG, and the
reason this works on a Grafana with no infrastructure behind it at all: a COG needs a server because
a GeoTIFF is not tiles, whereas a WMS **is** the server. The **Raster tile server** panel option
plays no part.

What the query produces is a dataset with no rows — `grafana-<refId>-wms` — holding where the
service is and which of its layers to draw, alongside the ordinary table dataset your rows make.

## Give it the bare endpoint

`https://services.geoglows.org/geoserver/satellite_based_precipitation/wms`, with no query string.

A whole `GetMap` URL pasted into the column is trimmed back to that, deliberately. Every request is
built by appending parameters to what you give, and the appending does not check whether a `?` is
already there — so anything after one survives only as a corrupted first parameter, and the server
answers with a parse error about a date it was never sent. Since pasting a whole `GetMap` URL is the
most natural thing to put in a column, the choice was between reading it charitably and drawing
nothing.

The cost of that is a service which genuinely needs a parameter on its endpoint — a MapServer
`?map=/path.map`. Those cannot be driven this way at all.

## The clock

Many environmental services publish one image per day or per hour and expect a `TIME` on the
request. The map's time widget walks those dates, and the dates can come from the query or from the
service itself. That is the subject of its own page: [Imagery over time](./imagery-over-time).

Worth knowing here: kepler draws a WMS but has **no notion of its time dimension**, so a time-aware
service would answer with its default slice for ever. Putting the date on the request is the
panel's doing.

## Clicking asks the service

A WMS carries no rows, so the only way to know what is under a pixel is to ask the server —
`GetFeatureInfo`, which is what a click does on a queryable layer. kepler shows the answer in its
popover, and a **click mapping** on the field `wms_value` sends it to a dashboard variable, so the
panels around the map can read it. See [Cross-filtering](../dashboard/cross-filtering).

kepler asks only while the layer's **Allow hover** switch is on. kepler.gl gave the WMS layer that
switch in 3.3.0-alpha.16, turned off; the panel starts it on, so a WMS answers clicks as it did
before, in saved dashboards too. Turned off, the layer stops showing its popover and a click on it
asks the service nothing.

On a relief base map the switch also decides who draws the layer. While it answers clicks (tooltip
on, the layer queryable, **Allow hover** on) deck draws it, as one picture of the view laid on the
relief, since kepler asks the service about the pixel deck found in that picture. Otherwise it is
handed to the base map as 256-pixel tiles, which lie on the relief to the horizon. See
[Rasters on the relief](../map/basemaps-and-relief#rasters-on-the-relief).

`wms_value` is the first value the service returned, under a name that is the same everywhere. The
attributes also arrive under their own names — both as the service spells them (`GRAY_INDEX`) and as
kepler displays them (`GRAY INDEX`) — for a vector WMS returning several.

The question carries **the date on screen**, so the answer is about the image you are looking at
rather than the service's default. And it is the service's answer verbatim: a sentinel like `-99`
means _no data here_, not a failure.

::: tip A click that seems to do nothing
kepler's time widget sits over the bottom-centre of the map and takes the clicks that land on it.
That is indistinguishable from a layer that cannot be queried. Click somewhere else on the map
before concluding the layer is not queryable.
:::

## What to expect of the service

- **CORS.** The browser fetches the pictures, so the service has to allow it. This is not the COG
  arrangement, where a server in the middle does the reading.
- **A strict CSP** needs the host in `connect-src`, **not** `img-src`. A WMS image is fetched and
  parsed as data rather than pointed at by an `<img>`, so the obvious directive is the wrong one —
  and the symptom is a map that draws nothing, silently, with no CSP message about images. See
  [Install](../install#hardened-grafana).
- **The capabilities document** is read once per service per page load, and it can be large: nearly
  a megabyte on GeoGLOWS, whose hourly layers list fourteen thousand dates.
- **A date the service does not have** comes back as an empty picture. That is why nothing is ever
  guessed: with no calendar from either side, no `TIME` is sent and the service answers with its own
  default.

## Reading it instead of drawing it

A WMS hands out pictures, which is a wall for anything you want to _compute_. But a GeoServer that
publishes a WMS usually publishes a **WCS** over the same coverage — the same scene, delivered as
pixels rather than as a rendering — and that turns the imagery on the map into something a query can
work on, with no second source and no ETL.

See [Measuring imagery](../sources/measuring-imagery#wcs).
