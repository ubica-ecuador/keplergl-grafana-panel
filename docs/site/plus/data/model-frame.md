# Data in a model's frame

A digital twin's data often comes in its 3D model's own coordinates, not in latitude and longitude: a sensor at x, y
and z metres on the plant's drawings, a reading per part of a BIM model, a forklift tracked indoors, a pipe or a room
drawn in the building's axes. Plus places such rows where the map's [4D Model](/plus/layers/model-4d) stands its
model, so every layer draws them, and they follow the model when it is moved or turned.

![Eraring Power Station as a 4D Model with two kinds of callout placed in its frame: one on top of each unit, named by its part of the model, and three sensors at x, y and z metres on the units, none of them with latitude or longitude in its query](/img/plus/model-frame.jpg)

::: info Since Plus 1.7.0
Data in a model's frame is new in Plus 1.7.0, not released yet.
:::

## See it in the layer tour

The **Digital twin** map of the [layer tour](/plus/start/templates#digital-twin), installed with the app, shows CO₂ sensors, a chilled-water riser and two people and a cleaning robot written in the building's own metres,
on the app's sample building, on synthetic data. Open it and press ▶ on its time filter to replay the day.

## What it needs

- A [4D Model](/plus/layers/model-4d) layer on the same map. Its rows' latitude and longitude place the model's
  origin, its **Heading** turns it and its **Altitude** lifts it.
- A query with some of these columns, by these exact names:

| Column           | What it is                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model_x`        | Metres east of the model's origin, as the model is drawn before **Heading** turns it.                                                                                        |
| `model_y`        | Metres north of the origin, the same way.                                                                                                                                    |
| `model_z`        | Metres up from the origin. Optional: 0.                                                                                                                                      |
| `model_part`     | A part of the model, by its node name: the row stands on top of that part, over the middle of its footprint, and `model_x`, `model_y` and `model_z` then move it from there. |
| `model_heading`  | Optional: a heading in degrees clockwise from the model's north, such as a robot's yaw against the building's axes.                                                          |
| `model_geometry` | Optional: GeoJSON whose coordinates are metres of the model's frame, `[x, y]` or `[x, y, z]`: pipes, ducts, rooms, zones, routes.                                            |
| `model`          | Optional: which 4D Model layer the row belongs to, by its label or its id, when the map has several. Without it, the first.                                                  |

A query with `model_x` and `model_y`, with `model_part`, or with `model_geometry` is placed. Its rows gain
`latitude`, `longitude` and `altitude` (and `heading` from `model_heading`, `geometry` from `model_geometry`),
replacing columns of those names, before any layer reads them. To the map, they are ordinary points, headings and
geometries.

## Drawing the rows

Add a layer on the query and set its columns to `latitude`, `longitude` and, for a layer that draws in 3D, `altitude`:

- a [3D Callout](/plus/layers/callout) puts a card with each sensor's value and day on it;
- a [Fleet](/plus/layers/fleet) draws people, robots and forklifts moving through the building;
- a [Pipeline](/plus/layers/pipeline) or kepler's line layer reads `geometry` for pipes and ducts;
- kepler's polygon layer reads `geometry` for rooms and zones, extruded with a height column;
- any point layer: icons for cameras, a heatmap of readings.

The points follow the model: change its **Heading** or **Altitude** in kepler's side panel and they move with it at
once, before the dashboard is saved.

A row is drawn nowhere, rather than at the origin, when its part is not in the model, when the model has not loaded
yet (it is placed once it has), or when it has no coordinates.

## Sensors on a plant

Sensors known by their part of the model, or by metres on the drawings:

```sql
-- One callout on top of each unit, 3 m above its roof.
SELECT u.name, u.duid, r.mw,
       u.duid AS model_part,
       3      AS model_z
FROM latest_readings r JOIN units u USING (duid);

-- Sensors at their place on the drawings.
SELECT s.name, s.code AS sensor, r.value,
       s.x AS model_x, s.y AS model_y, s.z AS model_z
FROM sensor_readings r JOIN sensors s USING (code);
```

## People and forklifts indoors

![Eraring's four units drawn see-through, with two forklifts on the ground floor and two workers on the 24 and 36 metre levels inside the units, each with its trail](/img/plus/model-frame-indoor.jpg)

Positions in the building's frame, with a time and an asset, drawn by a [Fleet](/plus/layers/fleet) layer:

```sql
SELECT t.ts AS time, t.tag AS asset, p.name, p.type, t.status,
       t.x AS model_x, t.y AS model_y, t.level_m AS model_z,
       t.yaw AS model_heading   -- optional; without it, Fleet takes the heading from the track
FROM tag_positions t JOIN people_and_vehicles p USING (tag)
WHERE $__timeFilter(t.ts);
```

On the Fleet layer, set **Altitude (above ground)** to `altitude` and **Display** to **3D**, so each asset stands on
its level, and turn **Altitude line** off. For a replay of past positions, set **Time reference** to **History**.

Then give the 4D Model an **Opacity** under 1: drawn see-through, the model no longer hides what stands inside it.
Opaque, it hides the assets behind its walls, as a building does.

For a building of several floors, give the rows a floor column and turn on [Floors](/plus/indoor/#with-a-4d-model):
a floor picker then shows one floor at a time inside the model.

## Pipes and rooms

![Eraring's units drawn see-through, with a steam header running along them, a riser from each unit up to it, and a control room on a floor of each unit coloured by its temperature](/img/plus/model-frame-geometry.jpg)

Geometry drawn in the model's metres, such as DuckDB's `ST_AsGeoJSON` of a geometry in local coordinates:

```sql
-- Pipes, with their height on each vertex: drawn by a Pipeline layer.
SELECT name, steam_mw, ST_AsGeoJSON(geom) AS model_geometry FROM pipes;

-- Rooms as polygons at their floor's height: drawn by kepler's polygon layer with 3D on.
SELECT name, temperature, height_m, ST_AsGeoJSON(outline) AS model_geometry FROM rooms;
```

A pipe that rises, such as a riser from a unit to a header, is drawn by [Pipeline](/plus/layers/pipeline#lines-that-rise)
with its width facing the screen. A room's polygon stands at its own height, its floor: turn on the polygon layer's
**Height** and pick a height column, as for any polygon in kepler.

## Alerts on these rows

The rows are placed before the panel's [Active alerts](/plus/data/active-alerts) read them, so an alert whose
**Entity label** names a sensor or a unit is placed on it, and a 3D Callout or a [layer's cards](/plus/layers/cards)
show it.

## When it does not draw

- **Nothing from the query.** The map has no 4D Model layer, or its rows have no latitude and longitude for the
  model's origin. Or the column names are not exactly `model_x`, `model_y`, `model_part` or `model_geometry`.
- **The points are on the ground at the right place, not up in the model.** The layer's altitude column is not set
  to `altitude`, or the map is not tilted.
- **The points are turned or mirrored against the model.** Coordinates read off the glTF file itself have Y up and
  −Z north: use its x, −z and y as `model_x`, `model_y` and `model_z`. A BIM model's own x, y and z, from the
  IFC that was converted to glTF, are usually right as they are.
- **Parts named in `model_part` draw nothing.** The names are not the model's node names; check them in a glTF
  viewer, as for the 4D Model's **Part ID**.
- **Assets inside the model are hidden.** The 4D Model is opaque: set its **Opacity** under 1.
