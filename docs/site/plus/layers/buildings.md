# Buildings

The base map's buildings, each one coloured by a value: the air temperature from the street sensors around it, the
readings of the sensors inside it, an index of the district or tract it stands in, anything aggregated to H3 cells.
The buildings are OpenStreetMap's, with their heights, so no dataset of buildings is needed; the layer's rows bring
only the values.

![East Harlem at 15:00 on 21 July 2019, the hottest hour of a heat wave, tilted: every building coloured by the air temperature estimated at its centre from the street sensors around it, pale orange by Central Park, dark red in the middle of the neighbourhood, the sensors as dots, and the buildings more than 250 m from any sensor grey](/img/plus/buildings.jpg)

::: info Since Plus 1.7.0
The Buildings layer is new in Plus 1.7.0, not released yet.
:::

## See it live

[New York's street heat, block by block](https://pacha.ubica.dev/d/nyc-street-heat), on the public demo instance:
the July 2019 heat wave from the city's Cool Neighborhoods street sensors, hour by hour, with the same buildings
coloured three ways, by the sensors around them, by their ZIP code's Heat Vulnerability Index and by H3 hexagon.
Hover a building for its card: its temperature over the ten days.

## The buildings

The layer draws OpenStreetMap's buildings as the vector tiles of [OpenFreeMap](https://openfreemap.org/) carry them,
whatever base map the map shows:

- **Where**: the tiles in view, from zoom 12, within 3.5 km of the centre of the view. A tilted map that shows the
  horizon draws them only that far; zoomed further out than 12, none.
- **Height**: each building's height in OpenStreetMap, or its levels; 5 m where it has neither. **Height scale**
  multiplies them all.
- **Shape**: each footprint as it is in the tiles, holes included, extruded from the ground to its height. A building
  across two tiles is drawn in two halves that meet at the tiles' edge.
- **Hide the base map's 3D buildings** (on by default): while the layer shows, the base map's own 3D buildings
  (Liberty's, or the ones the **3D building** switch adds) are hidden, so each building is drawn once, in its colour.

On a relief base map each building stands on the ground under its centre.

## Light and shadow

Under kepler's **Light & Shadow** effect the buildings cast real shadows at the effect's time: on each other, and on
the ground, which the layer covers with a clear surface that shows only the shadows falling on it.

![The centre of Cuenca with the Buildings layer in grey and kepler's Light & Shadow at 16:30: the buildings lit from the west, their shadows falling east across the streets, the lower roofs and Parque Calderón](/img/plus/buildings-shadows.jpg)

1. Add a Buildings layer. With no value to colour them by, every building is drawn in the layer's colour, a grey
   that takes light well.
2. Open the effects button in the map control (top right) and add **Light & Shadow**
   ([Effects](/guide/kepler/effects)).
3. Set its time in the same panel: a date and time, the current time, or **animation**. Its shadow intensity, colours
   and light are set there too, and saved with the map.

In **animation** the sun follows the map's own clock: a trip's time, or the start of a time filter shown enlarged.
Otherwise Plus takes the end of the map's time filter window, whatever its view, so a [Time Brush](/plus/time-brush)
writing variables the map's filter follows moves the sun and the shadows with it; and on a map with no time filter,
the dashboard time range's end (a Time Brush writing the range, or the time picker). (kepler alone would take midnight
of 1970 there: night over the whole map.)

At night kepler turns the sun off and darkens the whole map; Plus lights the buildings then with a faint, cool light
from high on the side opposite the sun, as a moon, so their roofs and walls still read apart.

Buildings coloured by a value take the effect lighter, so their colours still read in the shade and at night:
**Light and shadow on the buildings** (0.35) sets how much of its shadow and its light they take, from 0 (every face
in its colour) to 1 (as the ground). The ground under them takes the effect's own shadow, and they cast the full one.
Buildings in one colour take all of it.

![The same streets coloured by a value at 07:00: the shadows fall west across the streets, dark on the ground, and the buildings keep their reds, oranges and yellows on the faces turned from the sun](/img/plus/buildings-shadows-colour.jpg)

Other 3D layers drawn by deck.gl (a City Model, 3D shapes, extruded polygons, models) cast and take shadows as well:
3D Shape cylinders standing as a square's trees cast theirs on the clear ground. The clear ground comes with the
Buildings layer. On a base map with relief the ground takes no shadow (the clear surface is flat), the buildings
still do. For each spot's hours of shade over a day, add a [Shade](/plus/layers/shade) layer.

## Where the value comes from

The layer's rows give the values, and how kepler reads them, its **column mode** in the layer's columns, decides how
a building gets one:

| Column mode                   | The rows are                         | A building takes                                            |
| ----------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| **Sensors (points)**          | sensors, with latitude and longitude | the value estimated at its centre, or its sensors' readings |
| **Polygons (GeoJSON or WKT)** | areas, with a geometry column        | the value of the polygon its centre stands in               |
| **H3 cells**                  | H3 cells, with a column of ids       | the value of the cell its centre stands in                  |

The value itself is the layer's colour column: pick a numeric column in **Color based on**. A Buildings layer is
never created by itself: add one with **Add Layer** and pick **Buildings** as the layer type, or switch a point layer
to it.

### Sensors around a building

With **Value from: Sensors around (interpolated)**, each building takes the value estimated at its centre from the
closest sensors, by inverse distance weighting: the estimate a [Surface](./surface) layer draws between sensors, so a
Surface and a Buildings layer on the same rows agree.

| Setting              | Default   | What it does                                                                                                       |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| **Power**            | 2         | how fast a sensor counts less with distance; higher keeps each sensor more local                                   |
| **Neighbours**       | Auto (12) | how many of a building's closest sensors make its estimate; **All** weighs every sensor                            |
| **Max distance (m)** | no limit  | a building farther than this from its closest sensor gets no value: a sparse network paints only round its sensors |

```sql
-- Street sensors, one row per sensor and hour; the layer takes each sensor's newest reading in the time range.
SELECT sensor, latitude, longitude, time, temp_c
FROM readings
WHERE time >= $__timeFrom() AND time < $__timeTo();
```

### Sensors inside a building

With **Value from: Sensors inside**, each building takes the sensors standing in its footprint: their mean, lowest or
highest (**Several inside**). A building with none inside has no value. For sensors that are inside buildings: rooms,
meters, an indoor network.

### Polygons

With the **Polygons (GeoJSON or WKT)** column mode, the rows are areas, with a geometry column of polygons or
multipolygons (GeoJSON, WKT or WKB, as for kepler's GeoJSON layer; see [Geometry](/guide/data/geometry)). Each building
takes the value of the polygon its centre stands in; where polygons overlap, their mean, lowest or highest
(**Several inside**).

```sql
-- ZIP codes with an index; the layer colours each building by its ZIP code's.
SELECT zcta, hvi, geometry          -- geometry: WKT
FROM zip_codes
WHERE hvi IS NOT NULL;
```

![Upper Manhattan's buildings coloured by the Heat Vulnerability Index of their ZIP code, from 1 to 5: East Harlem's in dark purple, the Upper East Side's and the Upper West Side's in pale lavender, the buildings of the ZIP codes not queried left out](/img/plus/buildings-polygons.jpg)

A polygon's value is the same for all its buildings: the map is a choropleth standing in 3D, read building by building.
The building itself is the base map's; the polygon only gives the value, so polygons coarser or finer than the
buildings both work, down to one polygon per building (a cadastre with a value per parcel).

### H3 cells

With the **H3 cells** column mode, the rows are [H3](/guide/data/h3-and-s2) cells: a column of ids, as text, and a
value. Each building takes the value of its cell, at the finest resolution the rows have (rows of several resolutions
are tried finest first).

```sql
-- Sensors averaged per H3 hexagon of about 0.1 km² on the server (DuckDB's h3 extension).
SELECT h3_h3_to_string(h3_latlng_to_cell(latitude, longitude, 9)) AS h3,
       avg(temp_c) AS temp_c
FROM readings
GROUP BY 1;
```

![The same East Harlem hour with each building coloured by the mean of the sensors in its H3 hexagon: blocks of one colour where the map above shades smoothly, the buildings in hexagons with no sensor grey](/img/plus/buildings-cells.jpg)

H3 ids need 64 bits, more than a number keeps: give them as text (`h3_h3_to_string` in DuckDB), or as 64-bit
integers the datasource hands over whole. Ids that arrive as plain numbers are refused, and the layer says so.

Cells are the way to bring anything the server can aggregate onto the buildings: a raster's mean per cell (land
surface temperature, tree canopy, a flood model), counts of events, a model's grid.

### Over time

Rows that repeat a sensor, a polygon or a cell over time (one per hour) are made one value each, among the rows the
time range and kepler's filters keep: **Per sensor or area** is **Last** (the newest), **Mean**, **Min** or **Max**.
With a [Time Brush](/plus/time-brush) moving the time range, the buildings follow it.

## Colours

The buildings are coloured by the layer's colour scale on the value column, as any kepler layer is: a palette and a
scale in the **Color** group, and the legend reads them. Classes of your own (**Custom** scale, a colour per
threshold) keep the same colours for every hour and every place: see
[Colour palettes and scales](/guide/kepler/colour-palettes-and-scales).

- **Without a value**: a building with no value (no sensor close enough, none inside, in no polygon or cell) is drawn
  **Grey** or left out (**Hidden**). **Colour without a value** sets the grey, a mid grey by default that reads on
  light and dark base maps alike.
- **Sensors as dots** marks each sensor in the colour of its own reading, **Dot radius** pixels wide (sensors' column
  mode only).
- **Opacity** is kepler's, 0.9 for a new layer: the base map shows between the buildings, not through them.

## The hover

Pointing at a building tells its value and where it came from:

| Line               | Says                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| **Estimated**      | sensors around: the estimate at the building's centre, or why it has none |
| **Sensors inside** | sensors inside: how many stand in the building                            |
| **Value**          | the value, from the sensors inside, the polygon or the cell               |
| **Band**           | the colour class the value falls in                                       |
| **Closest sensor** | sensors around: how far the closest sensor is                             |
| **H3 cell**        | cells: the cell the value came from                                       |
| **Height**         | the building's height, metres                                             |

A sensor's dot gives its own reading.

## Cards

With **Cards → Show** at **Card on hover**, the building under the pointer shows a card over its roof in place of the
hover box: its value at the map's instant, in its colour, and its chart over the dashboard's time range. The card is
worked out as the building's colour is, time by time:

![East Harlem at 15:00 on 21 July 2019, the buildings coloured by the air temperature around them, and over one building near Park Avenue its card: Estimated at this building, 37.9 °C in the building's dark orange, and a chart of the ten days from 20 to 45 °C, with a peak every afternoon and the hour shown marked on the 21st](/img/plus/buildings-card.jpg)

| Value from         | The card's chart                                                                     | Header                          |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------- |
| **Sensors around** | the estimate at the building's centre, from the closest sensors reading at each time | Estimated at this building      |
| **Sensors inside** | their mean, lowest or highest (**Several inside**)                                   | Its sensor, Its 3 sensors       |
| **Polygons**       | its polygon's readings; where polygons overlap, their mean, lowest or highest        | the polygon's first text column |
| **H3 cells**       | its cell's readings                                                                  | H3 and the cell's id            |

Sensors seldom read at the same instant: at each time, a sensor counts with its newest reading if that is no older
than one and a half of its usual gap, so a sensor that stopped reporting drops out of the estimate instead of
carrying its last reading on.

The card stays for a moment after the pointer leaves, so the pointer can reach it, and has a pin in its header: a
pinned card stays on the map, kept with the map by the building's centre, and shows whenever its building is drawn.
Save the dashboard to keep the pins. A sensor's dot keeps its hover box. There is no **Cards always**: a map in a city
draws thousands of buildings.

**The chart and the instant.** A card reads the rows past kepler's time filter, while the colours read only the rows
the filter keeps. So query the whole range, one row per sensor and hour, and add a time filter on the hour, synced
with the dashboard's time by a [Time Brush](/plus/time-brush): the buildings take the hour's colours, and each card
charts the whole range with a dot on that hour. Without a time filter, a card shows the newest reading. See
[Cards on any layer](./cards#what-a-card-shows) for the instant.

| Option           | What it does                                                                       | Default                 |
| ---------------- | ---------------------------------------------------------------------------------- | ----------------------- |
| **Show**         | **Tooltip** (the hover box) or **Card on hover** (pinnable).                       | Tooltip                 |
| **Placement**    | **Above, on a stem**, over the roof, or **Beside** the building.                   | Above                   |
| **Time**         | The time column the chart runs along; **None (value only)** shows the value alone. | Auto (first time field) |
| **Unit**         | Text after the value, kept as typed: a leading space sets it apart (` °C`).        | empty                   |
| **Size**         | **Small**, **Medium** or **Large**.                                                | Small                   |
| **Min**, **Max** | The chart's vertical range. Empty: from the readings.                              | auto                    |

The value is the layer's colour column. **Min** and **Max** matter on a map whose values swing every day: a heat
wave's 20 to 45 °C reads the days and nights better than 0 to 50.

## Writing it in a saved map

Like any Plus layer, in the map's saved configuration. The panel names a geometry column `_geojson` and an H3 column
`h3` when it hands the query to kepler, so a layer written by hand names those:

```json
{
  "id": "hvi",
  "type": "buildings",
  "config": {
    "dataId": "grafana-A",
    "label": "Heat Vulnerability Index",
    "columnMode": "geojson",
    "columns": { "geojson": "_geojson" },
    "isVisible": true,
    "visConfig": { "buildingsEmpty": "hide", "buildingsHideBasemap": true }
  },
  "visualChannels": { "colorField": { "name": "hvi", "type": "integer" }, "colorScale": "quantize" }
}
```

For cells, `"columnMode": "h3"` and `"columns": { "hex_id": "h3" }`; for sensors, `"columnMode": "points"` and
`"columns": { "lat": "latitude", "lng": "longitude" }`, with `"buildingsMode": "interpolate"` or `"inside"`.

The cards are in the same `visConfig`: `"cardShow": "hover"`, and `cardPlacement` (`"above"` or `"beside"`),
`cardTimeField`, `cardUnit`, `cardSize` (`"S"`, `"M"`, `"L"`), `cardMin` and `cardMax`. The pins are written to
`cardPinned` by the pin on each card.

## Good to know

- **OpenStreetMap's heights** are as good as the city's mapping: where buildings have neither a height nor levels,
  they all stand 5 m high.
- **The value is the place's, not the building's**: street sensors give the air around a building, an index gives its
  district's. With data about the buildings themselves (energy, occupancy, alarms), use sensors inside, or polygons
  that are the buildings.
- **A raster** reaches the buildings through the server: its mean per H3 cell, or per footprint as polygons, computed
  once, then drawn by this layer.
