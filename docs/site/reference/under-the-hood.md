# Under the hood — deck.gl

You never write deck.gl props here: kepler does that, from the settings in its layer panel. But
knowing which deck.gl layer is actually doing the drawing explains a lot of behaviour that is
otherwise mysterious — why a layer tolerates a million rows and another does not, why nothing drapes
over terrain, why clicking works the way it does.

::: info Extracted, not recalled
The mapping below was read out of the **installed** `@kepler.gl/layers` 3.3.0-alpha.9 and
cross-checked against deck.gl's own catalogue. Bundled deck.gl is **9.3.10**.
:::

## Which deck.gl layer draws what

### Data-driven layers

| kepler layer   | deck.gl layer                                                   | Package                                       |
| -------------- | --------------------------------------------------------------- | --------------------------------------------- |
| point          | `ScatterplotLayer`                                              | `@deck.gl/layers`                             |
| heatmap        | `HeatmapLayer`                                                  | `@deck.gl/aggregation-layers`                 |
| grid           | `GridLayer` (via kepler's `EnhancedCpuGridLayer`)               | `@deck.gl/aggregation-layers`                 |
| hexagon        | `HexagonLayer` (via kepler's `EnhancedHexagonLayer`)            | `@deck.gl/aggregation-layers`                 |
| cluster        | `ScatterplotLayer` inside a kepler `CompositeLayer`             | `@deck.gl/layers`                             |
| icon           | kepler's own `SvgIconLayer`, a `CompositeLayer`                 | `@deck.gl/core`                               |
| geojson        | `GeoJsonLayer`                                                  | `@deck.gl/layers`                             |
| hexagonId (H3) | `H3HexagonLayer`, plus `ColumnLayer` when extruded              | `@deck.gl/geo-layers`, `@deck.gl/layers`      |
| s2             | `S2Layer`                                                       | `@deck.gl/geo-layers`                         |
| arc            | `ArcLayer`                                                      | `@deck.gl/layers`                             |
| **line**       | **`ArcLayer` with `getHeight: 0`**                              | `@deck.gl/layers`                             |
| **flow**       | **`FlowmapLayer` — not deck.gl**                                | `@flowmap.gl/layers`                          |
| trip           | `TripsLayer`, plus `ScenegraphLayer` for a 3D model at the head | `@deck.gl/geo-layers`, `@deck.gl/mesh-layers` |

Two of those are worth pausing on.

**A kepler Line is a flattened Arc.** It is deck.gl's `ArcLayer` with the height forced to zero, not
`LineLayer`. That is why a line layer's controls look like an arc layer's, and why the two perform
identically.

**A Flow layer is not deck.gl at all.** It comes from [flowmap.gl](https://github.com/visgl/flowmap.gl),
a separate visgl project that the plugin bundles (Apache-2.0). That is why its settings — clustering,
adaptive scales, _Max Top Flows_ — have no equivalent anywhere else in kepler, and why the deck.gl
documentation will not help you with them.

### Layers configured with a URL

| kepler layer | deck.gl layer                         | Package                |
| ------------ | ------------------------------------- | ---------------------- |
| vectorTile   | `MVTLayer` / `TileLayer`              | `@deck.gl/geo-layers`  |
| rasterTile   | `TileLayer` with kepler's raster mesh | `@deck.gl/geo-layers`  |
| wms          | `WMSLayer`                            | `@deck.gl/geo-layers`  |
| tile3d       | `Tile3DLayer`                         | `@deck.gl/geo-layers`  |
| bitmap       | `BitmapLayer`                         | `@deck.gl/layers`      |
| 3D           | `ScenegraphLayer`                     | `@deck.gl/mesh-layers` |

These take a URL rather than data. Two of them a query can supply that URL for — `rasterTile` from a
`raster_url` column and `wms` from a service and layer name — and the other four are added by hand.
See [Rasters](../guide/data/rasters), [WMS services](../guide/data/wms) and
[Layers configured with a URL](../layers/url-configured).

## What follows from it

### Volume

The layer family tells you roughly what to expect. These are orders of magnitude on ordinary
hardware, not promises:

| Family                               | Comfortable                              | Why                                                         |
| ------------------------------------ | ---------------------------------------- | ----------------------------------------------------------- |
| Scatterplot (point, cluster)         | hundreds of thousands                    | one quad per row; the cheapest thing deck.gl draws          |
| Aggregation (heatmap, grid, hexagon) | hundreds of thousands in, few cells out  | binning happens on the CPU each time the parameters change  |
| Arc / line                           | tens of thousands                        | each arc is tessellated into segments                       |
| GeoJSON                              | depends entirely on vertex count         | a hundred detailed boundaries can outweigh a million points |
| Trip                                 | tens of thousands of points              | the whole path is uploaded; animation is a shader uniform   |
| Flow                                 | capped at **5,000** displayed by default | `Max Top Flows`; see [Flows](../guide/data/flows)           |

The binding constraint is usually **transport**, not rendering: every row travels from the data
source through Grafana into the browser as JSON before deck.gl sees it. Aggregating in SQL is almost
always cheaper than aggregating in a layer.

### Nothing drapes over terrain

deck.gl draws in its own coordinate system, at the altitude your data specifies, over whatever the
base map happens to be showing. The relief in the two terrain base maps belongs to **MapLibre**;
deck.gl has no knowledge of it.

So a path across a valley floats at its nominal height rather than following the ground, and a
polygon on a mountainside cuts through it. This is not a bug in the styles and there is no setting
for it. See [Base maps and relief](../guide/map/basemaps-and-relief).

### Altitude is height above the ground

A path's third coordinate is metres **above ground level**, not above sea level. Map an `elevation`
column of 2,650 m and the trace is drawn 2.65 km up — visible from far away, gone once the camera
descends below it.

That is why the panel's altitude role has no autodetected column names. See
[Field roles](./field-roles).

### Picking

Clicks and hovers work by **colour picking**: deck.gl renders an off-screen frame in which every
feature has a unique colour, then reads the pixel under the pointer. It is exact rather than
geometric, and it costs one extra render pass.

Two consequences worth knowing when you build a click-driven dashboard:

- **What you click is what is drawn.** A point with radius 1 is a one-pixel target. Raise the radius
  before concluding that click publishing is broken.
- **Only the topmost feature is picked.** Overlapping layers hand you the one on top, which is the
  one highest in the layer list.

See [Cross-filtering](../guide/dashboard/cross-filtering).

### Precision

kepler's documentation lists a **High-precision rendering when zooming in closely** switch on seven
layer types. In the version this plugin bundles it is **not wired to anything**: it survives as a
constant and a TypeScript type in kepler 3.3.0-alpha.9, and no layer declares or reads it.

deck.gl retired the separate 64-bit code path years ago; its current handling shifts coordinates
relative to the viewport centre and is always on. There is nothing to enable, and nothing to pay
for.

This is a case where [upstream documentation is ahead of, or behind, what ships](./upstream-docs).

### Trail length

`Trail Length` on a Trip layer is deck.gl's `trailLength` on `TripsLayer`, and kepler multiplies the
value you type **by 1,000** before handing it over. kepler exposes the control but does not document
it; deck.gl documents the prop but not the multiplier.

### Two WebGL contexts per map

Each map holds one context for MapLibre and one for deck.gl. Browsers cap the total at around
sixteen, so roughly **eight maps per page** — fewer with split views, which double a map's
allocation.

Past the cap the browser evicts the oldest context and those maps go black, with
`Too many active WebGL contexts` in the console. Collapsed Grafana rows are the mitigation; see
[Map settings](../guide/kepler/map-settings).

## Reading further

deck.gl's own documentation, for when this page stops being enough:

- [Layer catalogue](https://deck.gl/docs/api-reference/layers)
- [Performance](https://deck.gl/docs/developer-guide/performance)
- [Coordinate systems](https://deck.gl/docs/developer-guide/coordinate-systems)
