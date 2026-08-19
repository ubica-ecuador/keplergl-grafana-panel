# Layers and attributes

The panel on the left of the map is **kepler.gl's own**, unmodified. Layers, their styling, the
blend modes, the ordering — all of it is documented upstream, and this page only covers what is
different about using it inside a Grafana panel.

## What the panel has already done for you

By the time you open the layer list, the panel has turned each query into a dataset and, where it
could, built the layer:

| You get automatically | From                           |
| --------------------- | ------------------------------ |
| Point                 | a lat/lng pair                 |
| Polygon / GeoJSON     | a geometry column              |
| H3 hexagon            | a column of valid H3 indices   |
| Trip                  | a trip id + time + position    |
| Flow                  | origin and destination columns |

See [How a query becomes a map](../data/how-a-query-becomes-a-map). Everything else — heatmap, grid,
hexbin, cluster, icon, arc, line, S2 — you create by hand here, choosing the dataset and pointing
the layer's columns at it.

## Adding a layer by hand

**+ Add Layer** → pick a type → pick the dataset → assign its columns. The columns offered are the
ones your query returned, under the names the panel gave them: coordinate roles arrive as `latitude`
and `longitude`, geometry as `_geojson`, origin/destination as `lat0`/`lng0`/`lat1`/`lng1`. Every
column without a role keeps its original name.

## Attributes

Every layer has colour, "colour based on", a palette, a scale and opacity. Beyond that they diverge:
point-like layers have radius and stroke, aggregation layers have cell size and coverage, polygons
have extrusion and wireframe. kepler's own reference is the place for the full list.

Two are worth calling out here because they cause confusion in a dashboard:

**Radius.** kepler's default point radius is small, and on a country-sized view a few thousand
points can read as an empty map. This is the first thing to change, not the last.

**High-precision rendering when zooming in closely.** kepler's documentation lists this on point,
arc, line, icon, geojson, hexagon and grid layers. **It is not there in the version this plugin
ships.** The setting survives as a constant and a type in kepler 3.3.0-alpha.7, but no layer
declares or reads it — deck.gl retired the separate 64-bit path years ago and its current
precision handling is always on. Do not go looking for the switch. See
[Under the hood](../../reference/under-the-hood).

## Styling does not save itself

Everything you set here lives in kepler's store. It survives a query refresh — the panel swaps data
underneath your layers rather than rebuilding them — but **not a page reload**, until you capture it
with **Map configuration → Save current map**. See [Map configuration](../map/map-configuration).

## Layers a query cannot drive

Six of kepler's layer types are configured with a URL rather than with data: vector tile, raster
tile, WMS, 3D tiles, bitmap, and 3D models. No query can drive them, so the panel never builds one.
You can still add them by hand if you have a URL — and on a hardened Grafana you will need its host
in `connect-src`. See [Layers a query cannot drive](../../layers/url-configured).

---

**Upstream:** [Types of layers](https://docs.kepler.gl/docs/user-guides/c-types-of-layers) ·
[Layer attributes](https://docs.kepler.gl/docs/user-guides/d-layer-attributes) ·
[The kepler.gl workflow](https://docs.kepler.gl/docs/user-guides/b-kepler-gl-workflow)

Written against **kepler.gl 3.3.0-alpha.7**, which is what this plugin bundles. kepler's public
documentation describes the 3.2 stable line and lists fifteen layer types; the pre-release registers
nineteen, the Flow layer among them. See [Upstream documentation](../../reference/upstream-docs).
