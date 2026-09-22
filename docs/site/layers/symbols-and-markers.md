# Symbols and markers

Two layer types the plugin adds, both of which draw a shape rather than a dot. One is per row of a
query; the other is a handful of handles you drag.

## symbol

![The symbols layer](/img/layer-symbol.jpg)

```sql
SELECT station        AS name,
       lat            AS latitude,
       lon            AS longitude,
       wind_speed,
       wind_direction
FROM observations;
```

**Built automatically** from a position and a **numeric bearing** — `bearing`, `heading`, `course`,
`cog`, `track`, `azimuth`, `orientation`, or a wind `direction`. One mark per row, turned to the
column's degrees, and the Point layer kepler would have guessed from the same coordinates is removed
rather than left underneath it.

Over a thousand shapes are available: the plugin's own `arrow`, `circle`, `square` and `triangle`,
plus Maki's 215, Temaki's 556 and 272 of the UN OCHA Humanitarian Icons — all CC0, all bundled, none
fetched at runtime. The picker sorts them into sixteen themes and opens on the one in use.

The layer's own panel carries the rest: size fixed or by column, outline, drop shadow, a gradient
that lightens each symbol towards its tail, upright symbols for a tilted view, labels from any
column, and thinning that drops the marks which would overlap at the current zoom.

It can also draw **a picture per row** instead of a shape — a logo per operator, a photograph per
site — loaded through an ordinary `<img>` so it works under a strict Content-Security-Policy.

See [Symbols](../guide/data/symbols).

### A wind is read differently from a course

Meteorology names a wind by where it comes *from*; everything else names where it is *going*. The
layer reads a wind direction the first way and a bearing the second, and the convention can be set
explicitly. Get it wrong and the whole fleet points backwards — which reads as bad data rather than
as a setting.

## markers

![The markers layer](/img/layer-markers.jpg)

**Never built automatically**, and it draws nothing from its dataset. Add it by hand, then add as
many markers as you need: each one is a draggable point bound to a pair of dashboard variables.

Dropping a marker writes its pair once, on release, so a query hanging off it — an isochrone, a
radius, a route — runs once per gesture. The variables are the source of truth, so a marker also
moves when the pair arrives from a text box or a shared link.

See [Markers](../guide/map/markers).

## Which of the two you want

| You want                                                    | Layer     |
| ----------------------------------------------------------- | --------- |
| a mark per row, turned by what the query says                | `symbol`  |
| a handle the reader drags, feeding a query                   | `markers` |
| a mark per row with no bearing, and no icon                  | `point`   |
| the flow through a grid rather than the marks on it          | [Streamlines or vector field](../guide/data/velocity-fields) |
