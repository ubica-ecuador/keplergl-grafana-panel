# WMS services

A WMS is not a file: it is a service that draws pictures on demand. So the query hands over an
address and a name rather than data, and the panel builds the dataset and its layer.

```sql
SELECT 'https://services.geoglows.org/geoserver/satellite_based_precipitation/wms' AS wms_url,
       'persiann_pdir_24h' AS wms_layer;
```

| Role      | Detected from                     |
| --------- | --------------------------------- |
| WMS URL   | `wms_url`, `wms`, `service_url`   |
| WMS layer | `wms_layer`, `layer`, `layer_name` |

The two go together: a service publishes many layers, so a URL without a layer name is not a
picture. **Both must be present or neither role applies.** Like the raster role, neither appears in
the Field mapping editor — alias them in the query if your columns are named otherwise.

<video src="/img/guide-rasters.mp4" poster="/img/guide-rasters.jpg" autoplay loop muted playsinline controls aria-label="The PERSIANN precipitation WMS on the map: dragging the time widget makes the service redraw the scene for each date, and the statistics beside it follow" style="width:100%;height:auto;border-radius:8px"></video>

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
