# Route

A route with its heights along it: a trail, a climbing route, a cycling or running track, a drone or a glider's
flight. The line is coloured by its grade or its height, laid on the ground or drawn in 3D, and a **profile** under the
map charts its heights against the distance along it, with its length, climb, descent, height range, steepest grade
and time. Point at the profile and the place shows on the map; point at the route and the place shows on the profile;
drag across the profile to measure a section.

## What the query needs

Either of kepler's two ways of giving a line, as for its GeoJSON layer:

- **One row per route**, with a geometry column holding a LineString or a MultiLineString (GeoJSON, WKT or WKB hex;
  see [Geometry](/guide/data/geometry)). A third coordinate is the height of the vertex in metres above the sea; a
  fourth, a time.
- **One row per point** (a GPX track, a drone's fixes): pick the **table** columns in kepler's layer panel, an **id**
  that groups the points into routes, **lat** and **lng**, and optionally an **altitude** in metres above the sea and
  a **sort by** column, the points' time. The panel names a query's `lat` and `lon` columns `latitude` and `longitude`.

```sql
-- A track's fixes, joined into one route per flight.
SELECT flight, lat, lon, altitude_m AS altitude, time FROM fixes ORDER BY flight, time;
```

A string column named `name`, `route`, `trail`, `track`, `title` or `label` names a row's route; in the table mode the
id names it.

A Route layer is never created by itself: add one with **Add Layer**, or switch a GeoJSON layer to it.

## Where the heights come from

**Heights** decides:

| Setting                            | Heights                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| **The rows' own, else the ground** | a z or the altitude column when the route has them; otherwise the ground |
| **The rows' own**                  | only the rows'; a route without them has no profile                      |
| **The ground**                     | always read off the ground                                               |

The ground is [Mapterhorn](https://mapterhorn.com/)'s terrain, the tiles the Relief switch draws, read in the browser
along each route: about 19 m a pixel worldwide, down to 2 m where finer data exists. Over cliffs a terrain model sees
the foot and the top of the wall, not the wall: a climbing route needs its own heights.

## A line drawn on the map

With **Lines drawn on the map** on (the default), a line drawn with the map's draw tool (**Line**, in the draw
controls) becomes a route of the first visible Route layer, its heights read off the ground: draw one anywhere and
its profile shows. **Cross-filtering → Publish drawn line** also writes it to a dashboard variable, for other panels'
queries along it (see [Publishing](/guide/dashboard/publishing#drawn-lines)).

## The profile

Under the map, the route shown: the one clicked on the map or chosen with the arrows, else the one last pointed at,
else the first. Its header lists the length, the climb and descent, the height range, the steepest grade and the
time; the chart fills its heights in the map's colours, with the legend under it.

- The pointer on the chart is a dot on the map, with the distance, height, grade and time at that place.
- The pointer on the route on the map is a line on the chart.
- A drag on the chart measures a section: its figures under the route's, and the section drawn brighter on the map.
  A double click, the **×** or Escape clear it.
- A route with times is on Grafana's [shared crosshair](/guide/dashboard/temporal-cursor) both ways: the place
  pointed at goes out as its time, and a time pointed at on another graph (a speed or altitude chart) puts the
  profile's line and the map's dot where the route was then. Set the dashboard's graph tooltip to **Shared crosshair**.

The arrow on the right folds the profile to its header.

## Options

| Option                     | What it does                                                                                                                   | Default |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **Colour by**              | **Grade** (six classes of steepness), **Height**, or **Stroke colour** (kepler's, by field)                                    | Grade   |
| **Stroke Width**           | line width in pixels                                                                                                           | 4       |
| **Heights**                | where the heights come from, above                                                                                             | auto    |
| **Draw at**                | **The ground**, or **Its heights**: in 3D, above the sea on a relief base map, from the layer's lowest height up on a flat one | ground  |
| **Elevation Scale**        | how much higher a height is drawn on a flat map (Its heights only)                                                             | 1       |
| **Grade over (m)**         | the grade at each place is the rise over this many metres around it                                                            | 50      |
| **Climb threshold (m)**    | a climb or a descent counts once it passes this many metres                                                                    | 4       |
| **Profile under the map**  | the profile                                                                                                                    | on      |
| **Lines drawn on the map** | lines drawn with the draw tool are routes too                                                                                  | on      |

The grade classes are under 5 %, 5–10, 10–15, 15–25, 25–40 and 40 % or more, steepness up or down.
