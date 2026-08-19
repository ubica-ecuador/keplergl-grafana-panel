# Quickstart

Five minutes from an installed plugin to a map you can pan. This assumes you have
[installed the plugin](./install) and have a data source that can return a table with coordinates
in it. If you have neither, [Tutorial 1](../tutorials/first-map) starts a step earlier and builds
one from a public URL.

## 1. Add a panel

New dashboard → **Add visualization** → pick your data source → choose **Maps by Kepler.gl** in
the visualisation picker at the top right.

## 2. Write a query that returns coordinates

Nothing special is required. Return latitude and longitude under names the panel recognises and it
does the rest:

```sql
SELECT lat  AS latitude,
       lon  AS longitude,
       recorded_at,      -- any time-typed column is detected
       speed_kmh         -- extra columns become tooltips and colour scales
FROM gps_readings
LIMIT 5000;
```

The map frames itself on the data and draws a Point layer. If your columns are called something
else, that is fine too — see step 4.

::: tip Points are small by default
kepler's default point radius is deliberately modest. If you are squinting at the screen looking
for your data, open the layer panel on the left and raise **Radius** before concluding nothing
rendered.
:::

## 3. Look at what it built

The panel on the left is kepler's own. **Layers** shows what was created, and clicking one opens
its full styling: colour, colour-based-on, radius, opacity, stroke. **Filters** adds a filter on
any column. **Interactions** controls the tooltip.

This is the real kepler.gl UI, so [kepler's own documentation](https://docs.kepler.gl/docs/user-guides)
applies to everything in it. What we document is everything _around_ it — see
[Using kepler's own panel](./kepler/layers-and-attributes) for the orientation, and
[Differences from stock kepler.gl](../reference/differences-from-kepler) for the handful of places
the panel departs from it.

## 4. Fix a column it guessed wrong

Open the panel options on the right and find **Field mapping**. Each query gets its own block, and
every role shows the detected column as a placeholder. Set one to override it, or set it to
**None** to switch that role off entirely — which is how a query carrying a `trip_id` gets drawn
as loose points rather than as trajectories.

The full list of roles is in [Field roles](../reference/field-roles).

## 5. Save the layer styling

Layer styling lives in kepler's store, not in Grafana's, so it needs to be captured deliberately:
**Map configuration → Save current map**. That writes the layers, filters and base map into the
dashboard JSON, and they come back on the next load.

Saving is explicit rather than automatic on purpose — the configuration is a sizeable blob, and
rewriting it on every pan would churn the dashboard for nothing.

## Where to go next

- Your rows are a geometry column, not a lat/lng pair → [Geometry](./data/geometry)
- Your rows are GPS traces with a vehicle id → [Trajectories](./data/trajectories)
- Your rows are an origin–destination table → [Origin–destination flows](./data/flows)
- You want the map to filter the rest of the dashboard → [Cross-filtering](./dashboard/cross-filtering)
- You want the dashboard time picker to drive the map → [Time range sync](./dashboard/time-range-sync)
- You want to see everything it can draw → [Layer gallery](../layers/)
