# Filters

kepler's filter panel is unchanged in the panel. What is worth thinking about in a dashboard is
**which of the two available filters to use** — because there are now two, and they behave very
differently.

## Two places to narrow data

|                      | Query filter (`WHERE`)       | kepler filter                 |
| -------------------- | ---------------------------- | ----------------------------- |
| Runs                 | in the database              | in the browser                |
| Rows removed         | never leave the database     | are still loaded, just hidden |
| Cost of changing it  | a query                      | nothing                       |
| Can be widened again | yes, re-queries              | yes, instantly                |
| Affects other panels | if it uses a shared variable | only through cross-filtering  |

The rule of thumb: **use the query to decide what data comes to the browser, and kepler filters to
explore it once it is here.**

A kepler filter is a _mask_. The rows are still loaded, so dragging a slider is free and reversible.
That is exactly what you want for exploration, and exactly what you do not want for reducing a
hundred million rows to a manageable set.

## The time filter

A dataset with a time column gets a time filter with a histogram and a brush. It is the same
mechanism as any other filter, with one difference: it carries a fixed domain, so narrowing the
brush does not rescale the histogram underneath it.

That property is what makes the _Slider writes variables_ time-sync mode work — the brush stays a
mask over the whole dataset, so you can always widen it again. See
[Time range sync](../dashboard/time-range-sync).

## Publishing a filter to the dashboard

A select, multi-select or text filter can be bound to a dashboard variable, and a numeric range
filter to a pair of them, so filtering the map filters every other panel. This is the two-way
channel: changing the variable also applies the filter on the map.

Set it up under **Cross-filtering** in the panel options, not in kepler's panel — see
[Cross-filtering](../dashboard/cross-filtering).

## Polygon filters and the draw tool

A shape drawn with the draw tool can be applied as a polygon filter on a layer. It can also be
published to a dashboard variable as WKT, which is a separate thing — the publishing happens as soon
as the figure is finished, whether or not you go on to make it a filter. See
[Publishing the viewport and drawn areas](../dashboard/publishing).

## Filters are part of the saved configuration

**Save current map** captures the filters along with everything else, so a dashboard can open with a
filter already applied. Worth remembering when a panel appears to be missing data that the query
clearly returns — check the filter panel before checking the query.

---

**Upstream:** [Filters](https://docs.kepler.gl/docs/user-guides/e-filters)

Written against **kepler.gl 3.3.0-alpha.9**. See
[Upstream documentation](../../reference/upstream-docs).
