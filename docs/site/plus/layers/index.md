# Plus layers

Plus adds eleven layer types to kepler's layer list. Each one is a kepler layer like any other: you pick it as the
layer type, style it in kepler's layer panel, and it is saved with the map. Most of them you add yourself, with
**Add Layer** or by switching the type of a layer the panel already built; each layer page says when the panel adds
one for you.

![European power grid on one map: renewable share as gauges, demand as 3D bars, interconnector flows as Traffic links](/img/plus/european-grid.jpg)

| Layer                                                 | Draws                                                          | Reads                            |
| ----------------------------------------------------- | -------------------------------------------------------------- | -------------------------------- |
| [Gauge](./gauge)                                      | A ring or a marker filled to a value, at each point            | Points                           |
| [3D Shape](./shape-3d)                                | A box, cylinder or prism whose height and colour are metrics   | Points                           |
| [Coverage and Coverage 3D](./coverage)                | Sectors from an azimuth, a beamwidth and a range; domes in 3D  | Points, one row per sector       |
| [Surface](./surface)                                  | Coloured bands and isolines between points, or a density count | Points                           |
| [Sparkline](./sparkline)                              | A card with each station's series and its current value        | Points, many rows per station    |
| [3D Callout](./callout)                               | A Sparkline card on a stem above each place, at its height     | Points, many rows per place      |
| [Traffic](./traffic)                                  | Link lines with comets running along them                      | Links, from a source to a target |
| [Pipeline](./pipeline)                                | The same flow along a real route                               | Line geometry                    |
| [Fleet](./fleet)                                      | Each vehicle or device once, where it is now, with a trail     | Positions with an asset column   |
| [4D Model](./model-4d)                                | A 3D model whose parts are built in time, or coloured by state | One row per part of a glTF model |
| [Floor plan](/plus/indoor/plans#the-floor-plan-layer) | A picture laid flat on the map, or on its floor indoors        | One row per picture              |

Points can come from latitude and longitude columns, or from a name that [Places](/plus/data/places) turns into
coordinates: a cloud region, an airport code, a country, a province.

## What they share

### One mark per place

A query that returns a time series for each site would pile marks on the same spot. Gauge, 3D Shape and Coverage
have a **Per place** setting that keeps one row for each place: **Last** (the default), **Min** or **Max**, or
**All** to draw every row. With an **Asset** column, a place is that asset rather than a pair of coordinates, so a
moving asset keeps one mark and glides between its reports. Each layer page says which column Min and Max read.

### The time filter and kepler's filters

The Plus layers follow kepler's filters and its time filter as kepler's own layers do, so pressing play replays them
with the rest of the map. See [Time playback](/guide/kepler/time-playback) and [Filters](/guide/kepler/filters).

### History in the popup

Gauge, 3D Shape, Coverage, Traffic and Pipeline have a **History** setting in their **Interaction** group. Hovering a
mark then shows its readings over the dashboard's time range under kepler's own fields, and a click pins the popup
with a larger chart. The chart draws the colour field by default, any other numeric field, or nothing (**Off**).

### Cards instead of the popup

The same layers and the 4D Model have a **Cards** group: a card per object with its reading at the map's instant and
its series, shown on hover in place of the popup, or all the time, beside the object or above it on a stem. See
[Cards on any layer](./cards).

### Clicks and drawn polygons

A click on a Plus layer reaches the panel's click variables and is ringed on the map, as on kepler's layers. See
[Cross-filtering](/guide/dashboard/cross-filtering).

kepler's draw tool offers Gauge, 3D Shape, Coverage, Surface, Sparkline, 3D Callout and Fleet next to its own layer types, and a
polygon drawn with it filters them. Fleet filters per asset: an asset that is inside the polygon now keeps its whole
trail.

### Cards on top

Sparkline, 3D Callout and Fleet cards, and the [cards of any layer](./cards), are drawn above every layer, the map's
labels included, so the data they describe never hides them. The cards of several layers keep off each other: the
layer higher in kepler's list places its cards first.

### Data in a 3D model's frame

Every layer can draw a query written in the coordinates of a [4D Model](./model-4d) on the same map, by part or in
metres from its origin, instead of in latitude and longitude. See [Data in a model's frame](/plus/data/model-frame).

## The layer tour

The app installs the layer tour, **Kepler Plus tour — Plus layers**, with a map for each group of these layers on
synthetic data, beside three more tours for kepler's own layers, the map's interactions and indoor maps. Each layer page says
which map shows it. See [Template dashboards](/plus/start/templates).
