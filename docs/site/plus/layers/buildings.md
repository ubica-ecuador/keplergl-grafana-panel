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

## Good to know

- **OpenStreetMap's heights** are as good as the city's mapping: where buildings have neither a height nor levels,
  they all stand 5 m high.
- **The value is the place's, not the building's**: street sensors give the air around a building, an index gives its
  district's. With data about the buildings themselves (energy, occupancy, alarms), use sensors inside, or polygons
  that are the buildings.
- **A raster** reaches the buildings through the server: its mean per H3 cell, or per footprint as polygons, computed
  once, then drawn by this layer.
