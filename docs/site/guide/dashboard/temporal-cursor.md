# Temporal cursor

Move the pointer along a Time series graph and an amber marker follows the vehicle on the map, at
the position it had at that instant. Move it along the track or the map's time bar and the graphs'
crosshair follows instead. This is the shared cursor Grafana already passes between graphs, with the
map taking part in it.

Nothing is queried while hovering. The track is already in the browser: each move is a binary search
through its samples and a redraw of one marker, so it stays fluid with a hundred thousand points.

## Setting it up

1. In the dashboard settings, set **Graph tooltip** to **Shared crosshair** or **Shared tooltip**.
   Without that, graphs do not publish their cursor at all.
2. In the map panel, turn on **Temporal cursor → Show position on graph hover**.
3. For the other direction too, turn on **Map hover drives graphs**.

Both are off by default. With the first one off, the panel, including its time bar, behaves exactly
as before.

| Option                           | Default                 | What it does                                                                  |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| **Show position on graph hover** | off                     | Draws the marker for a graph's cursor, and the cursor's line on the time bar. |
| **Map hover drives graphs**      | off                     | Hovering a Point sample or the time bar moves the graphs' cursor.             |
| **Layer**                        | all compatible, visible | Restricts the marker to one saved layer.                                      |
| **Maximum sample age (seconds)** | 60                      | Hides the marker when the last sample before the cursor is older than this.   |

## Which layers

| Layer                           | Marker                                                               |
| ------------------------------- | -------------------------------------------------------------------- |
| **Point**                       | Yes, with a mapped time, latitude and longitude.                     |
| **Trip**, table                 | Yes. The trip ID separates vehicles.                                 |
| **Trip**, timestamped GeoJSON   | Yes: a LineString with `[longitude, latitude, altitude, timestamp]`. |
| Heatmap, Hexagon, Grid, Cluster | No: they draw aggregates, not a position.                            |
| Raster, WMS, Esri, Zarr         | No: they have their own timelines.                                   |

A Point dataset without a trip ID is treated as one track. Map a trip ID to follow several vehicles:
each gets its own marker.

To follow one layer only, **Save current map configuration** first, so its id exists, and then
choose it under **Temporal cursor → Layer**. Hidden layers, and layers hidden on one side of a split
map, get no marker on that side. The map's filters apply to the marker too: a sample filtered out
has none.

## What the marker shows

The last sample at or before the cursor. It is never extended past a track's first or last
timestamp, and it disappears where the gap to the previous sample is larger than **Maximum sample
age** — raise it for GPS that reports every few minutes. There is no interpolation between samples
yet.

## From the map to the graphs

With **Map hover drives graphs** on, hovering a sample of a **Point** layer publishes that sample's
time, so every graph's crosshair and every other map's marker moves to it. Trip layers do not
publish yet: kepler identifies a hovered trip as the whole path, not the vertex under the pointer.

## The time bar

The map's time bar takes part in both directions, in its minified and enlarged forms. A graph's
cursor is drawn on it as an amber line. With **Map hover drives graphs** on, hovering the bar
publishes the time under the pointer. Dragging a handle publishes nothing: the pointer is moving the
brush, not asking about a time.

The minified bar sits between two dates, so in a narrow panel it has little room to hover. Give the
map at least half of the dashboard's width.

## What it does not do

- It does not change the dashboard range, write variables, move the trip animation or re-run a
  query. It works alongside every [time range sync](./time-range-sync) mode and
  [peer time sync](./peer-time-sync).
- Grafana's Stat, Gauge and Bar gauge panels do not listen to the shared cursor: they always reduce
  the whole range. A Time series with **Tooltip → All** shows every series at the cursor instead.

## Example: GPS truck track

The **GPS truck track** dashboard, provisioned on the development benches, puts all of it together
on one 30-minute trip:

- a real road from Hamburg to Reading, Pennsylvania (© OpenStreetMap contributors, ODbL, routed by
  OSRM), with synthetic speed and elevation;
- the track coloured by speed on the same scale as the speed graph;
- the map and the stats following the dashboard range;
- the map's time brush shaded on both graphs, with
  [time window variables](./time-window-variables#shade-the-window-on-the-graphs).

It is built by `testdata/make-gps-truck.py`, which writes a TestData copy for the :3000 bench and an
Infinity copy for :3002.
