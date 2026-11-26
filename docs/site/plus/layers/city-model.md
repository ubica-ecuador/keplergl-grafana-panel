# City Model

An official 3D city model drawn as the model has it: every building with its sloped roofs, its towers and its wings,
each surface lit, from the CityJSON files a city or a country publishes (3DBAG for the Netherlands, PLATEAU for
Japan, the German states' LoD2) or from rows a query turns a model into. The buildings can be coloured by their
surface class, by one of their own attributes, by data joined to them, by the sensors around them, or by the sun
each roof gets.

![Edogawa, Tokyo, tilted over the Arakawa river: PLATEAU's model, every building coloured by the depth of the largest river flood PLATEAU expects there, orange for 0.5 to 3 m behind the embankment and red for 3 to 5 m near the river, with the legend's four classes](/img/plus/city-model.jpg)

::: info Since Plus 1.7.0
The City Model layer is new in Plus 1.7.0, not released yet.
:::

## See it live

On the public demo instance:

- [Edogawa under water](https://pacha.ubica.dev/d/edogawa-flood): PLATEAU's model of a Tokyo ward, 32 tiles and
  about 77,000 buildings, each coloured by the water PLATEAU's flood studies expect at it; draw an area on the map to
  count the buildings inside.
- [Amsterdam's buildings in 3D](https://pacha.ubica.dev/d/amsterdam-buildings-air): 3DBAG's tiles of the centre,
  coloured by the NO2 estimated from GGD's stations around each building, and a second map with the sun on every
  roof.

## Giving it a model

A City Model layer reads its model in one of three ways, set by kepler's column mode when the layer is added.

### Files

The browser fetches a CityJSON file (1.1 or 2.0) or a CityJSONSeq, gzipped or not:

- **Model URL**, one file for every row, or a column with each row's own (**URL column**: under **Auto**,
  `city_url`, `model_url`, `cityjson_url` or `url`).
- An `https://` address served with CORS for your Grafana's address, or a file of the plugin; any other address is
  refused, since every viewer's browser fetches it. A file is fetched without credentials, once per page however many
  layers and panels draw it, up to 300 MB.

The layer reads each building's highest level of detail (Solid, MultiSolid, CompositeSolid, MultiSurface or
CompositeSurface), its surfaces named by their semantics, its parts drawn as the building's, and its attributes kept
for the hover and the colours. An LoD 3 model is drawn whole: a house keeps its shell beside its balconies and
installations, the windows, benches and trees it draws from geometry templates are placed, and ceilings and floors
have a class of their own.

**Level of detail** picks which level a model with several (3DBAG: LoD 1.2, 1.3 and 2.2) draws: **The highest**,
with its roofs, or **The lowest** above LoD 0, lighter.

A CityGML file is refused, with what to do: convert it to CityJSON first, with
[citygml-tools](https://github.com/citygml4j/citygml-tools) (`citygml-tools to-cityjson`).

### Tiles

A city is published in tiles, and a query can give the tile index as rows: each tile's file and the box it covers.
The layer reads only the tiles in view, the nearest the centre first, again as the view moves.

| Column              | Notes                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| city_url            | the tile's CityJSON, as for files                                                               |
| west, south, east, north | its box in degrees; also `min_lng`… or `xmin`…                                             |
| or a geometry       | `tile_geometry`, `bbox`, `geometry`… in WKT or GeoJSON, as 3DBAG's WFS tile index gives it      |

```sql
-- 3DBAG's tiles over central Amsterdam, from its WFS tile index (BAG3D:tiles) in WGS84.
SELECT tile_id,
       'https://3dbag.fsn1.your-objectstorage.com/v20250903/tiles/' || tile_id || '/' ||
         replace(tile_id, '/', '-') || '.city.json.gz' AS city_url,
       west, south, east, north
FROM tiles;
```

- **Tiles at once** (32, from 4 to 150): how many tiles are read and drawn, the nearest the centre of the view. A
  tile already drawn stays while it is in view, so turning the camera does not swap the far ones in and out.
- **Triangles at once** (2,000,000): what a browser tab holds. Models past it, farthest from the centre first, are
  left out, and the map says so.
- A row without a box is read whatever the view.

### Rows

A model turned into rows on a server, one row per surface: a `POLYGON Z` in EPSG:4326 with its heights in metres, its
building and its class.

| Column        | Notes                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| geometry      | the surface, a POLYGON Z (GeoJSON, WKT or WKB, as kepler's GeoJSON layer reads it)                      |
| building_id   | its building (**Building column**; under **Auto** `building_id`, `parent_id`, `object_id`, `gml_id`, `id`) |
| surface_type  | `RoofSurface`, `WallSurface`, `GroundSurface`… (**Surface class column**; also `surface_class`, `semantic`, `class`) |
| anything else | shown in the hover, and a value to colour by                                                            |

Without a class column, a face that looks up is a roof, one that looks down is the ground, and the rest are walls.

## Where it stands

A file is placed by its own `referenceSystem`: WGS 84 and ETRS89 UTM, RD New and RD + NAP, Lambert-93, Gauss-Krüger,
LV95, SWEREF99, Finland's and Helsinki's, JGD2011's nineteen plane zones and its geographic CRS (PLATEAU), New York's
state plane in US feet, and a compound CRS by its horizontal part. **CRS** overrides it with an EPSG code
(`EPSG:25832`) or a proj4 string, for a file without one: citygml-tools drops it.

**Heights**:

| Setting                                          | The buildings                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| **Auto: the rows' own, a file's on the ground**  | the default                                                            |
| **The rows' own**                                | at their z as given                                                    |
| **Each building on the ground**                  | its lowest point on the ground, whatever the model's height datum      |

On a base map with relief each building stands on the ground under it, read on a coarse grid over each file and
lifted again only when the ground under its buildings changes.

**Ground surfaces** and **Closure surfaces** are hidden unless switched on: the ground is seen only from below, and a
closure surface is one a model adds to close a solid where it touches another, not a real wall.

## From afar: blocks

A city's model in tiles is too much to draw whole. From afar the layer draws blocks: the buildings' footprints at
their heights, light at any zoom, and the model's own tiles only close up, from zoom 15, each block giving way to its
building once that tile is drawn. Blocks are read from zoom 11, up to 220 tiles of them round the centre of the view;
they are painted, carded and seen by a Viewshed as the model's buildings are.

**Blocks from afar** says where they come from:

- empty, the default: [OpenFreeMap](https://openfreemap.org/)'s tiles, OpenStreetMap's buildings, anywhere, with
  nothing to prepare;
- a `{z}/{x}/{y}` template of vector tiles, or a `.pmtiles` archive, with a `building` or `buildings` layer
  (OpenMapTiles', Overture's, Protomaps');
- the `index.json` of a dataset of footprints in tiles of GeoJSON;
- `none`: no blocks, and the model's tiles read at any zoom.

## Colour by

| Colour by                         | Paints                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Surface class**                 | the default: roofs, walls, the ground and other surfaces each in their own colour                      |
| **Fill colour**                   | rows only: kepler's colour by any column                                                               |
| **The model's materials**         | files: each surface the colour its file gives it, CityJSON's appearance materials                      |
| **A building attribute**          | files: one of the buildings' own attributes, numbers in steps of the colour range, words in turn       |
| **Data joined by building**       | files: the panel's rows joined to each building, on kepler's colour scale and legend                    |
| **A Buildings layer's sensors**   | the estimate a [Buildings](./buildings) layer works out from its sensors, polygons or cells             |
| **Roof slope**                    | each roof face by its slope, 0 to 60°                                                                  |
| **Way a roof faces**              | each roof face by the eight directions; a flat roof keeps its class colour                             |
| **Sun on roofs**                  | each roof face's yearly sun in kWh/m²                                                                  |

**The model's materials** reads each surface's material under the geometry's first theme: its `diffuseColor`, with
`transparency` as opacity; a CityJSONFeature of a CityJSONSeq can carry its own. A surface without a material keeps
its class colour. A city cut into tiles keeps its roofs and walls in their own colours from tile to tile, as the rows
mode does with kepler's fill colour. A tile writes them as materials, for example:

```json
"appearance": { "materials": [ { "name": "Clay tile", "diffuseColor": [0.761, 0.376, 0.247] },
                               { "name": "Wall, lime-washed", "diffuseColor": [0.945, 0.91, 0.847] } ] },
"geometry": [ { "type": "MultiSurface", "lod": "2.2", "boundaries": [ ... ],
  "semantics": { "surfaces": [ { "type": "RoofSurface" }, { "type": "WallSurface" } ], "values": [0, 1, 1] },
  "material": { "colour": { "values": [0, 1, 1] } } } ]
```

**Paint** keeps a value's colour to **Every surface**, the **Roofs** or the **Walls**; the others keep their class
colour, as does a building with no value. The layer's own scales show in kepler's legend.

### Data joined by building

The rows the panel's queries return are joined to the model's buildings: kepler's colour field is the value, on
kepler's own scale (a Custom scale's steps too) and legend.

- **Key column**: the rows' column naming each building (under **Auto** `building_id`, `gml_id`, `identificatie` or
  `id`).
- **Matches**: the building attribute it matches; `id` is the model's own object id.
- **Per building**: rows that repeat a building, one an hour or one a sensor, make one value: **Last**, **Mean**,
  **Min** or **Max**.

The tile rows and the data rows can come from one query, each kind with the other's columns empty, as Edogawa's do:

```sql
-- The tiles, then one row per building under water: the layer colours those by key and leaves the others grey.
SELECT city_url, west, south, east, north, NULL::DOUBLE AS key, NULL::DOUBLE AS depth_m FROM tiles
UNION ALL
SELECT NULL, NULL, NULL, NULL, NULL, key, depth_m FROM flooded_buildings;
```

### Sensors around each building

Add a [Buildings](./buildings) layer on the sensors' rows and set its **Draw on** to the City Model layer: it then
draws only its sensors and works out its estimate (the sensors around, the sensors inside, the polygon or the H3 cell
each building stands in) over the City Model's own buildings, which take it on the Buildings layer's steps and legend.
The colours follow the map's time as it plays, without building the model again.

![Central Amsterdam tilted toward the Vondelpark: 3DBAG's buildings and OpenStreetMap's blocks beyond them coloured by the NO2 estimated from GGD's stations, teal by the park, red to the north toward the ring road, with the legend's six classes](/img/plus/city-model-sensors.jpg)

### The sun on the roofs

**Sun on roofs** gives each roof face its yearly sun, in kWh/m²: the place's **Global horizontal** (kWh/m² a year, 1,000
by default: about that in the Netherlands, 1,700 in Madrid) times a factor for the face's tilt and the way it faces at
its latitude. It is a face's potential, worked out for twelve days of the year under a clear sky: no shading by its
neighbours, no weather. At 52.4° N a south face at 35° gets 1.15 times the flat ground, a south wall 0.83, a north face
at 35° 0.68, close to what PVGIS gives.

![Amsterdam's canals from above the Dam, tilted: 3DBAG's roofs coloured by their yearly sun, yellow on the faces turned south, dark red on the steep ones turned north, the walls grey](/img/plus/city-model-sun.jpg)

## The hover and a click

**Hover picks** **The building**, which a hover lights whole, or **The surface**, the face alone with its area, its
slope, the way it faces and its sun. The hover lists the building's own attributes (its id and type, then the file's
first ones, twelve at most); a click writes all of them to the panel's click variables, as a feature's values go.
A hover needs **Allow hover** on.

## Cards

With **Cards** → **Show** set to **Card on hover** (see [Cards on any layer](./cards)), the building under the pointer gets
a card over its roof in place of the hover box:

- coloured by data, the rows joined to the building, the value (kepler's colour field, or a column) over the
  dashboard's range and its value at the map's instant;
- coloured by a Buildings layer's sensors, that layer's estimate at the building over time.

A pin keeps a building's card, by the building's id, and a pinned card stands once its file has loaded. A building
with no rows keeps the hover box.

## An area drawn on the map

An area drawn with the map's draw tool, or written to the panel's area variable, dims the buildings whose centre is
outside it, most of the way to grey: what is outside stays in sight, the buildings inside keep their colours. An
inverted area dims the inside, and holes and several polygons are kept. The rows are left as they are: the dashboard's
queries decide what else the area filters, as Edogawa's count of buildings under water does. The
[Buildings](./buildings#an-area-drawn-on-the-map) layer dims the base map's buildings the same way.

![Edogawa with a rectangle drawn on the map: the buildings inside in their flood colours, orange and red, the rest of the ward dimmed to brown-grey around them](/img/plus/city-model-area.jpg)

## Light and shadow

Under kepler's **Light & Shadow** effect the model's buildings cast and take real shadows, as the
[Buildings layer's](./buildings#light-and-shadow) do: coloured by class they take all of the effect; coloured by a
value they take a share of it on their own faces, so a shadow or the night does not hide their colours, and cast the
full shadow. Their shadows fall on the ground too, on a clear surface the layer lays over the view; on a base map with
relief that surface follows the ground the buildings stand on.

## With a Viewshed

A [Viewshed](./viewshed) can be hidden by a City Model of the map: its **Buildings from** lists each City Model layer
as **City Model:** and the layer's name. Each roof face is a footprint at its own height, so a building with a tower, a lower wing or a
gable blocks with its own shape.

## Good to know

- **What is read.** CityJSON and CityJSONSeq only. A file that draws nothing says why, on the map and under its URL:
  refused, not found or CORS, not CityJSON, no city objects, too large, or an unknown CRS.
- **Work off the page.** A file is read and built in a worker of its own, so a large model does not hold the page;
  changing a setting keeps the last mesh drawn until the next one is ready.
- **Saved maps.** In a saved map the layer is `citymodel`, with a GeoJSON base (`"columns": {"geojson": "geometry"}`)
  for rows, or `"columnMode": "files"` and `"columns": {}` for files and tiles; its settings are the `city*` keys of
  its `visConfig`. The [Assistant](/plus/assistant) knows them.
