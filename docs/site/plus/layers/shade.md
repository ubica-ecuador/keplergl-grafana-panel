# Shade

How many hours of shade each street, square and courtyard gets over a day: every spot coloured from the sunny
yellow of none to the deep blue of a day in the shade, from the sun's path against the buildings and the terrain.
The study planners call a shadow cast or a sun-hours analysis, on the dashboard's day.

![The centre of Cuenca over the 16th of November: the open squares and wide streets orange, a few hours of shade, the narrow streets between the blocks purple and deep blue, most of the day in shade, the base map's 3D buildings standing in the picture](/img/plus/shade.jpg)

::: info Since Plus 1.7.0
The Shade layer is new in Plus 1.7.0, not released yet.
:::

::: tip The shadows at a given time
For the shadows themselves at a time of day, cast on the ground and on the buildings, use kepler's **Light & Shadow**
effect over a [Buildings](./buildings#light-and-shadow) layer: no Shade layer is needed.
:::

## Adding it

Add a layer and pick **Shade**, on any dataset. **Where** says what is worked out:

- **Over the view** (the default): a square over what the map shows, from **From zoom** (14) in, its cells about
  2.5 m at street zooms. No row is read. It is worked out again when the map moves a quarter of the way out of it,
  or zooms across a step.
- **Round each place**: a circle of **Radius round each place** (150 m) round each row's position, at a chosen
  **Detail** (129, 257 or 513 cells across; Low past 8 places); up to 50 places, rows at one place counted once.

## The day

The day the dashboard's time range ends on, so a [Time Brush](/plus/time-brush) writing the dashboard range moves
it; or the day set in **Date** (2026-06-21). The day is the place's own, sunrise to sunset round its solar noon. The
sun's position is taken every **Sun every (minutes)** (15), from SunCalc's formulas, each position standing for its
minutes; the ramp runs from no shade to the day's whole hours of daylight. The hover names a spot's hours of shade
and of sun.

## What casts the shade

**Shade cast by**: the terrain (Mapterhorn's, as the Relief switch and the Viewshed read it), the base map's
buildings (OpenStreetMap's, with their heights, from OpenFreeMap's tiles), or both, the default. A building with no
height counts **Height without one** (10 m). The shade is worked out a margin past what is painted, so a building
just outside still casts its shadow in; a mountain kilometres off at sunset does not.

## How it is drawn

On the ground: a building's own cells are left clear for the base map's 3D buildings to stand in. On a base map with
relief, the picture is draped on the relief, as the Viewshed's. **Opacity** is in the **Color** group. Round each
place, **Day labels** writes the day and its hours of daylight over each circle.

## Limits

Only the sun's own light counts: no light from the sky or the walls, no half-degree penumbra. The buildings are
OpenStreetMap's, their heights often missing or rounded; a Buildings or City Model layer's buildings, and trees, are
not counted.
