# Publishing the viewport and drawn areas

Two more channels from the map to the rest of the dashboard: what the map is **looking at**, and
what you have **drawn on it**. Both are one-way, and both come with the same warning.

::: danger These are for the _other_ panels
Put either value in **this** panel's own query and the map filters itself. The data shrinks to what
is on screen, or to what is inside the shape — and zooming out or widening the shape cannot bring
those rows back, because the dataset no longer holds them.

It is a ratchet, and it feels like a bug the first time it happens. The option is named _Publish
viewport (for other panels)_ for exactly this reason.
:::

## The viewport

**Publish viewport (for other panels)** names four dashboard variables — west, south, east and
north — and the map writes the bounding box of what it is showing into them.

```sql
WHERE lng BETWEEN $west AND $east
  AND lat BETWEEN $south AND $north
```

### Four numbers, not a geometry

Deliberately. Four numeric variables carry no injection risk into a consumer's SQL, where a
free-text geometry would. There is nothing free-form for a consuming query to interpolate.

### When it publishes

**Once on load**, so a consuming panel never opens without bounds and never runs its first query
against four empty strings. Then **whenever the map comes to rest** — 300 ms after the last pan or
zoom, so a gesture costs one round of queries rather than one per frame.

Values are rounded to **six decimal places** and compared numerically against what the variable
already holds, so a view that has not really moved writes nothing. This matters more than it sounds:
kepler's store wakes on every pointer movement over the map, and each write would otherwise re-query
every panel that reads the pair.

Coordinates are **clamped to the ones that exist**. Zoomed far enough out the computed span runs
past the antimeridian and the poles, and no consuming query should be handed a longitude of −250.

### Practical notes

You can name fewer than four variables if your query only needs some of them — publishing is
per-variable.

A consuming query that also needs to survive a first load before any value arrives should guard for
the empty string the same way the other channels do.

## Drawn areas

kepler's draw tool produces a polygon or a rectangle. **Cross-filtering → Publish drawn area** writes
it to a dashboard variable as **WKT in EPSG:4326**, the moment the figure is finished — before you
have chosen a layer for it, if you were going to.

```sql
WHERE $area != ''
  AND ST_Intersects(geom, ST_GeomFromText($area, 4326))
```

Use it **unquoted**, with a guard for the empty value.

The variable must be a **text box** — the value is free-form WKT, so a query or custom variable
cannot hold it.

### Three deliberate limits

**Only the most recent figure is published.** Draw three shapes and the variable holds the third.
Deleting the last one clears the variable to the empty string, which is what the `!= ''` guard is
for.

kepler keeps no timestamps on its features, so "most recent" is positional: the figures arrive in a
deterministic order and the last new-or-changed one wins.

**The channel is one way.** Editing the variable by hand does not draw anything on the map. There is
no round trip.

**The value is never written on dashboard load.** A shared link keeps the area it was opened with,
rather than having it overwritten by whatever the map restored from a saved configuration. The first
pass only ever adopts what it finds.

### What counts as a figure

Anything kepler's editor holds that serialises to WKT — a polygon or a rectangle. A shape that has
been promoted into a polygon _filter_ on a layer is the same figure under kepler's covers, and it is
recognised as such rather than as a new drawing, so applying a drawn shape as a filter does not
republish it.

## Choosing between them

The viewport is coarse and automatic: it follows you around and needs no interaction. It suits
"show me numbers for what I am looking at".

A drawn area is precise and deliberate: it is a shape you meant. It suits "show me numbers for this
neighbourhood", and it survives panning, which the viewport by definition does not.

---

**Upstream:** the draw tool itself is kepler's —
[Draw on map](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/draw-on-map.md).
Publishing what you draw to a dashboard variable is this plugin's addition.
