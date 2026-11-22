# Publishing the viewport and drawn areas

Two more channels from the map to the rest of the dashboard: what the map is **looking at**, and
what you have **drawn on it**. Both come with the same warning, and the viewport is one way.

::: danger These are for the _other_ panels
Put either value in **this** panel's own query and the map filters itself. The data shrinks to what
is on screen, or to what is inside the shape — and zooming out or widening the shape cannot bring
those rows back, because the dataset no longer holds them.

It is a ratchet, and it feels like a bug the first time it happens. The option is named _Publish
viewport (for other panels)_ for exactly this reason.
:::

::: tip Reading the view on purpose
There is one case where a map should read its own view: a source too big to load whole, read for
what the map shows each time it moves — a GeoParquet or FlatGeobuf through a data source that reads
an area, such as the Spatial Catalog, or a large Parquet pruned by the box in SQL. The query re-runs
at every rest, a refresh keeps the view, and zooming out reads the wider box. Then kepler's filters,
histograms and legend count only what is on screen: say so on the panel, and keep a limit on the
rows.
:::

## The viewport

**Publish viewport (for other panels)** names four dashboard variables — west, south, east and
north — and the map writes the bounding box of what it is showing into them.

```sql
WHERE lng BETWEEN $west AND $east
  AND lat BETWEEN $south AND $north
```

### Four numbers, or one text

The four edges are numbers, and four numeric variables carry no injection risk into a consumer's
SQL: there is nothing free-form for it to interpolate. The [whole box in one
variable](#the-whole-box-in-one-variable) is text. The map only ever writes a box into it, but a
dashboard variable can also be set from the URL: interpolate it as a quoted, escaped string,
`${view:sqlstring}`, which reads the same on a data source that quotes variables
([DuckDB](../sources/duckdb-geoparquet)) and on one that does not ([PostgreSQL](../sources/postgis)).

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

### The whole box in one variable

The same box can go to **one** text box variable instead, or as well: **Whole box** names it, and
**as** picks its form.

| Form              | Value                                                                             | For                                                             |
| ----------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **WKT** (default) | `POLYGON((-79.05 -2.95, -78.95 -2.95, -78.95 -2.85, -79.05 -2.85, -79.05 -2.95))` | SQL, and every query written for the [drawn area](#drawn-areas) |
| **w,s,e,n**       | `-79.05,-2.95,-78.95,-2.85`                                                       | a `bbox=` parameter of an OGC API, WFS or STAC search           |

A data source that reads an area itself takes either as is: in the Spatial Catalog, put `$view` in
the query's area, and a GeoParquet, a FlatGeobuf or a feature service is read for what the map
shows. In SQL, the value is text, so interpolate it escaped:

```sql
WHERE ST_Intersects(geom, ST_GeomFromText(${view:sqlstring}))
```

It is published with the edges, at the same moments and in the same write, rounded and clamped the
same way. A variable that already holds the box (whatever its spacing or trailing zeros) is not
written again.

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

### How the variable behaves

**Only the most recent figure is published.** Draw three shapes and the variable holds the third.
Deleting the last one clears the variable to the empty string, which is what the `!= ''` guard is
for.

kepler keeps no timestamps on its features, so "most recent" is positional: the figures arrive in a
deterministic order and the last new-or-changed one wins.

**What reaches the variable from elsewhere is drawn on the map.** A shared link, the browser's back
button, another panel writing the variable: the map draws the area and applies it to every visible
layer as a polygon filter, as if you had drawn it and filtered by it, replacing the figures it had.
Emptied from elsewhere — the × of a Chaski filters panel's area filter, or its _Clear all_ — the
variable takes the figures off the map. The area never goes into this panel's query: it is a
filter in the browser, so the ratchet above does not apply. Only POLYGON and MULTIPOLYGON are read
(any case, an optional `SRID=…;` prefix); any other value leaves the map as it is.

**The value is never written on dashboard load.** A shared link keeps the area it was opened with,
rather than having it overwritten by whatever the map restored from a saved configuration. The first
pass only ever adopts what it finds. A link's area is drawn once the map has a layer to show: a
figure restored from the saved configuration with the same WKT is kept as it was saved, and nothing
is drawn over it; an empty variable on load leaves a restored figure alone.

## Drawn lines

The draw tool's **Line** draws a line. **Cross-filtering → Publish drawn line** writes it to a
dashboard variable as `LINESTRING (lng lat, …)` in EPSG:4326, for queries along it: the rows near
the line, how far along it each one lies, a vertical section through a 3D grid under it, a profile.

```sql
-- Cells within ~1 km of the line, and how far along it each one lies, in km.
WITH line AS (SELECT ST_GeomFromText($line) AS g WHERE $line != '')
SELECT ST_LineLocatePoint(line.g, ST_Point(lon, lat)) * ST_Length_Spheroid(ST_FlipCoordinates(line.g)) / 1000 AS km,
       level, value
FROM cells, line
WHERE ST_Distance(ST_Point(lon, lat), line.g) < 0.01
```

The rules are the area's: **unquoted**, with a guard for the empty value, a **text box** variable,
the most recent line published once it rests, the variable emptied when it is deleted, nothing
written on dashboard load, and never this panel's own query. Areas and lines are apart: a polygon
goes to the area's variable, a line to the line's. It is map to variable only: a line arriving in
the variable from elsewhere is not drawn on the map.

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
