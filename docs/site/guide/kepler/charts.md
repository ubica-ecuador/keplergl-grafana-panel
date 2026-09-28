# Charts

kepler's charts panel: big numbers, bars, lines, heatmaps and pivot tables over the map's data, and
**tooltip charts** that plot an entity's own history in its popup. The button is in the map control
at the top right.

## The button is the plugin's, the feature is kepler's

kepler ships the charts panel whole — the button, the panel, the charts and their state — but, as
with [effects](./effects), its stock map control never mounts the button and nothing in the core
mounts the panel. The plugin wires both, the way kepler's own demo app does.

Charts are saved with the map: **Save current map** captures them with the layers and filters, and
a provisioned dashboard opens with them in place. See [Map configuration](../map/map-configuration).

## Tooltip charts

Two of the chart types — **Tooltip: Time Series** and **Tooltip: Category** — do not draw in the
panel but in the popup. Create one from the panel, pick the **layer** it belongs to, and set its
**Feature id field**: when you hover a point, the chart plots every row that shares that point's id.

That is what turns a map of stations into a map of time series. With one row per station per
minute and the station name as the id field, hovering a station draws its whole day, whatever the
time filter shows.

A tooltip chart needs a layer whose hover points at a row of data: points, polygons, lines, H3
hexagons, trips and the plugin's symbol layer do. kepler's aggregation layers (**Hexbin**, **Grid**
and **Cluster**) do not: a hover there points at a bin of many rows, not at one. Nor do markers,
raster and tile layers, or the flow fields, so none of them can carry one.

## Comparing two entities

Turn on **compare mode** in kepler's tooltip settings (**Interactions → Tooltip**). Click one
entity to pin its popup, then hover another: both popups show, each with its own chart. When the
panel is set to confirm selections from the popup, only the pinned popup offers **Select**.

Compare mode is saved with the map, so a provisioned dashboard can open with it already on — kepler
itself forgets it when loading a saved map, and the plugin puts it back.

## Pinned charts

A chart's pin keeps it on the map with the panel closed, like a pinned legend. It takes the column
beside the map control, so on a short panel it can cover much of the map; unpin it, or give the
panel more height.

## Cross-filters stay in the map

Clicking a bar or a point of a chart filters the map and the other charts. By default it does not
reach the dashboard: those filters never drive the dashboard's time range, and a **Filter**
mapping ignores them even when they filter the column it maps. To send a chart's selection to the
dashboard, add a mapping with the source **Chart cross-filter** for that column; see
[Cross-filtering](../dashboard/cross-filtering).

## Limits of this kepler version

- A **Line** chart draws a single series: a group-by adds the groups up into one line instead of
  drawing one line per group. To compare groups over time, use a **Heatmap** with time buckets on
  one axis and the groups on the other. Keep the buckets to ten or fewer, or the heatmap drops
  some (see below): over 24 hours, three-hour buckets make eight or nine.
- A **Heatmap** leaves any cell with a value of zero or below blank. Plot a quantity that stays
  positive — a height above its own minimum, not an anomaly around a mean.
- A heatmap axis shows at most ten groups: the ten with the most rows, in alphabetical order. A
  time bucket with fewer rows than the others, such as the current one still filling, is the first
  to go; label buckets so that they sort in time order, year first.

## Cost

A pinned chart that applies the map's filters recomputes as the time filter plays. Measured on a
pinned heatmap applying the map's filters, on the seven-station dashboard, the difference in
scripting time during playback was within the noise of the measurement.

---

**Upstream:** kepler documents the charts panel in its repository rather than on the docs site.

Written against **kepler.gl 3.3.0-alpha.15**. See
[Upstream documentation](../../reference/upstream-docs).
