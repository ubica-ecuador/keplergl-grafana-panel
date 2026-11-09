# Points and aggregation

Nine ways to read the same 123 rows. Every image on this page comes from a single query returning
`latitude`, `longitude`, a numeric `value` and a categorical `zona` — the difference is entirely in
which layer you point at it.

```sql
SELECT lat AS latitude,
       lon AS longitude,
       value,
       zona
FROM readings;
```

Only the first is built for you. The other eight you add in kepler's layer panel: **+ Add Layer**,
pick the type, pick the dataset.

## point

![The point layer](/img/layer-point.jpg)

One circle per row. Colour and radius can each be driven by a column, which is usually enough to
read a dataset before reaching for anything cleverer.

Built automatically from a latitude/longitude pair. Backed by deck.gl's `ScatterplotLayer` and the
cheapest thing on this page — hundreds of thousands of rows is comfortable.

::: tip
The default radius is small. On a country-sized view a few thousand points can look like an empty
map; raise **Radius** before concluding nothing rendered.
:::

Two effects under **Visual**, both off by default:

- **Glow** puts a soft halo round each point: **Extent** is its radius as a multiple of the point's
  (2 by default), **Strength** how bright it is.
- **Pulse / Ripple** animates each point: **Pulse** swells and shrinks it, **Ripple** sends a ring
  out from it, at **Speed** cycles a second and out to **Expansion** times its radius. With
  **Trigger** set to **Continuous** every point pulses all the time; with **At event time** a point
  pulses when the end of the map's time window reaches the time in its **Event timestamp** column,
  and for **Duration** of timeline time after it. That needs an enabled time filter on the same
  column: the one [Time range sync](../guide/dashboard/time-range-sync) puts on the map is one, as
  is one added in kepler's filter panel; without it the layer panel says what is missing. The
  pulses follow the window as it plays or is dragged, which makes events stand out: earthquakes,
  alarms, sales.

## heatmap

![The heatmap layer](/img/layer-heatmap.jpg)

A continuous density surface. Good for "where is the concentration", useless for "how many" —
there is no legend that makes a heatmap quantitative, and the apparent intensity changes with zoom.

**Weight** can be driven by a column; left alone it counts rows.

**3D Surface** lifts the heatmap into a relief whose height is the density, up to **Maximum height**
in metres; tilt the map to see it. **Surface shading** lights it, and **Surface contours** draws
lines across it every **Contour step** of density. The height is density, not terrain: it does not
follow the base map's relief.

Backed by deck.gl's `HeatmapLayer` from `@deck.gl/aggregation-layers`; the surface is a mesh kepler
builds from the same density.

## contour

![The contour layer](/img/layer-contour.jpg)

Lines of equal density, the way a topographic map draws equal height. The points are counted into a
grid, smoothed, and traced at a number of levels, each band filled in a colour of its own; the
legend lists the levels. Where a heatmap only says "more here", a contour says "at least this much
inside this line" — hover a band and it reads, for instance, `value ≥ 12`.

- **Weight**: a numeric column, averaged within each cell. Left empty, the contours are of the
  number of points per cell.
- **Number of levels** (7), **Grid resolution** (cells along the longer side of the data, 64) and
  **Smoothing** (in cells, 3) shape the lines: more cells follow the points closely, more smoothing
  rounds them off.
- **Fill below each level** turns the bands inside out, to enclose the lows instead of the peaks.
  **Custom level range** sets the lowest and highest level yourself, so two maps can share them.
- **Fill**, **Color by level**, **Opacity** of the fill and **Outline width**.

It takes a latitude/longitude pair or a GeoJSON column (the centre of each shape). New in kepler.gl
3.3.0-alpha.20. The contours are computed in the browser, again with every filter change; keep the
rows to tens of thousands.

Backed by deck.gl's `GeoJsonLayer`.

## grid

![The grid layer](/img/layer-grid.jpg)

Square bins, sized in metres by **Grid Size**. Unlike a heatmap it is quantitative: each cell has a
value you can colour and extrude, and a legend that means something.

Extrusion turns it into a 3D histogram, which needs the 3D control and reads best with a lighting
effect turned on.

Backed by deck.gl's `GridLayer`.

## hexagon

![The hexagon layer](/img/layer-hexagon.jpg)

The same idea with hexagonal bins. Hexagons have a single distance to all six neighbours, which
avoids the diagonal artefacts a square grid produces on clustered data — the reason most people
prefer them for movement data.

**Coverage** shrinks each hexagon within its cell, which is how you get the gaps between them.

Backed by deck.gl's `HexagonLayer`. Distinct from the H3 layer: this bins raw points _in the
browser_, while [hexagonId](./geometry-and-indices#h3) draws cells your data already carries.

## cluster

![The cluster layer](/img/layer-cluster.jpg)

Points grouped into circles sized by how many they contain, re-clustered as you zoom. The familiar
"47" bubble from web maps.

Better than a heatmap when the count matters and better than raw points when they overlap, but note
that the clusters are a rendering artefact — they change as you zoom, so they are not a stable unit
to compare.

Backed by a kepler `CompositeLayer` over deck.gl's `ScatterplotLayer`.

## voronoi

![The Voronoi layer](/img/layer-voronoi.jpg)

**Voronoi Mosaic** in the layer menu. Each point gets the part of the map that is nearer to it than
to any other point, so every place on the map takes the colour of its nearest point: stations
becoming the areas they stand for, without interpolating between them. Colour it by a column as you
would a point layer; the cells have an outline, dark by default.

The cells stop at the data's bounding box, widened on each side by **Bounds Padding** (10 % by
default). Nearness is measured on the map, not along streets: a cell is not a catchment area.

It takes a latitude/longitude pair or a GeoJSON column (the centre of each shape). New in kepler.gl
3.3.0-alpha.20, never built for you; switching a point layer's type to it keeps its columns.

Backed by deck.gl's `PolygonLayer`, the cells computed in the browser with `d3-delaunay`.

## icon

![The icon layer](/img/layer-icon.jpg)

A symbol per row, chosen per row by a column holding an icon name.

```sql
SELECT lat AS latitude, lon AS longitude, icon, zona
FROM stations;
```

The icon library ships **with the plugin** rather than being fetched from a CDN, which is what makes
this work on an air-gapped install and under a strict `connect-src`. The names are kepler's own; the
picker in the layer panel lists them.

Useful for a small number of meaningful things — stations, incidents, depots. At a few hundred rows
it becomes noise.

An **angle** column turns each icon by its own number of degrees, **counter-clockwise** (since
kepler.gl 3.3.0-alpha.20). A compass bearing runs clockwise from north, so pass `360 - heading`, or
use the [symbol](#symbol) layer, which reads a bearing as it is.

## symbol

A symbol per row, turned and sized by columns. Its **Draw** selector picks what each symbol is:

- **A shape**: one of about a thousand map symbols — the plugin's own shapes, Maki, Temaki and the
  UN OCHA humanitarian icons (named `temaki:…` and `ocha:…`) — coloured by the layer. The
  **Category** selector above it narrows the list to one theme (hazards, weather, transport, power
  and utilities…), and typing searches within it. The shape can be outlined, shadowed and
  lightened towards its tail. kepler's own interface icons are no longer listed; a dashboard that
  already uses one keeps drawing it.
- **A picture**: an image of your own, drawn in its own colours. Paste a URL, or upload a PNG, JPEG,
  SVG, WebP or GIF of up to 75 KB, which is kept inside the dashboard. To give each row its own
  picture, bind a column of URLs as the layer's **picture URL** column; a row with an empty value
  takes the layer's picture. **Anchor** puts the picture's centre or its bottom edge on the point —
  bottom for pins.

```sql
SELECT lat AS latitude, lon AS longitude, logo_url AS picture, name
FROM depots;
```

The browser loads a picture the way it loads an `<img>`, so a strict Content-Security-Policy needs
nothing beyond Grafana's default `img-src * data:`. Two things still stop one:

- **CORS.** The map is drawn with WebGL, which refuses an image from another origin unless its
  server answers with `Access-Control-Allow-Origin`. A picture that opens in a browser tab can still
  fail on the map. Uploading the file sidesteps the question.
- **Mixed content.** A picture over `http:` on a Grafana served over `https:` is blocked by the
  browser.

Pictures load in the browser of whoever views the dashboard, with their Grafana session, so a
picture column should come from data you trust.

The layer panel names each picture that could not load, and why. A layer draws at most 96 different
pictures. Rows beyond that take the layer's picture, or, when the layer has no picture of its own,
are not drawn; the panel says which.

## Choosing between them

| You want                           | Use             |
| ---------------------------------- | --------------- |
| Every row, individually            | point           |
| Where the concentration is         | heatmap         |
| Lines you can read a level off     | contour         |
| Counts you can compare and extrude | grid or hexagon |
| A readable count at every zoom     | cluster         |
| The area each point stands for     | voronoi         |
| Categorical symbols                | icon            |
| Turned shapes, or pictures         | symbol          |

And a rule that outranks all of them: **if the aggregation can happen in SQL, do it there**. A
million rows binned in the browser is a million rows transported first. `GROUP BY` on an H3 index or
a rounded coordinate sends a few thousand instead — see [H3 and S2](../guide/data/h3-and-s2).
