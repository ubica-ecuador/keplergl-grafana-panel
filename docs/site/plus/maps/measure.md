# Measuring on the map

Draw a line or an area with the map's draw tool and Plus measures it: a line's length on the map and along the
terrain, its climb and descent, the heights at its two ends and the straight line between them; an area's surface
and its perimeter. Nothing to set up: the figures show in a box at the top left of the map as soon as a shape is
drawn.

![A line drawn across Cuenca on a satellite map, from the river to the airport, and the box at the top left listing Length 3.27 km, Along the terrain 3.27 km, Climb · descent ↑ 34 m · ↓ 31 m, Heights 2530 → 2534 m (+4 m), Straight line in 3D 3.26 km and Slope +0 % (0.1°)](/img/plus/measure.jpg)

::: info Since Plus 1.7.0
Measuring is new in Plus 1.7.0, not released yet.
:::

## Drawing

Open the draw tool in the map's controls and pick **Line**, **Polygon**, **Rectangle** or **Circle**:

- **Line**: click each vertex, double-click the last.
- **Polygon**: click each vertex, click the first again to close it.
- **Rectangle** and **Circle**: click where the shape starts (a corner, the centre), then where it ends.

The box measures the shape last drawn. Select another drawn shape on the map (the draw tool's **Select**), or step
through them with ‹ ›, to measure it. × closes the box until the next shape is drawn. Drawn shapes are kepler's: they
also filter the map's layers when used as a filter, and the drawn lines feed a [Route](/plus/layers/route) layer's
profile.

## The figures

A line:

| Figure                  | What it is                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **Length**              | along its vertices on the map, the horizontal distance                                            |
| **Along the terrain**   | the same path over the ground's rises and falls, longer on a slope                                |
| **Climb · descent**     | metres up and down along the way, a change counted once it passes 4 m (a Route's climb threshold) |
| **Start to end**        | the horizontal distance between the two ends, for a line of more than two vertices                |
| **Heights**             | the ground's height above the sea at each end, and the difference                                 |
| **Straight line in 3D** | from end to end through the air: √(horizontal² + difference²)                                     |
| **Slope, start to end** | the difference over the horizontal distance, as a grade and an angle                              |

The heights come from Mapterhorn's terrain tiles, the same the Relief switch, the Route layer and the Line of Sight
layer read, at a spacing that follows the line's length; they show once the tiles have loaded. They are the ground's,
not a roof's or a tree's.

An area (a polygon, a rectangle or a circle): its **Area** on the earth's surface, holes taken out, in m², hectares or
km², and its **Perimeter**.

The figures are the same as a [Route](/plus/layers/route)'s profile shows for the same line. Heights and distances on
3D tiles, a scan or a building's roof are not measured yet: the box reads the ground.
