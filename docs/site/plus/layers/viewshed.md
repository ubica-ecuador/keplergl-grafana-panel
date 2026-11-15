# Viewshed

What each place sees: a lookout over a valley, a fire tower over a forest, a camera over a square, an antenna over
a town. Each row is an observer with its eye height, its range and its field of view, and the layer paints the ground
it sees in its colour and shades the rest of its range. The view is hidden by the terrain, by buildings, or by both;
the earth's curvature lowers far points.

![Two lookouts over Cuenca, 15 km each: the Turi viewpoint south of the city sees the city and the slopes beyond it in yellow, the Tres Cruces pass in El Cajas sees patches of the high plateau in green, and the rest of each circle is shaded grey](/img/plus/viewshed.jpg)

::: info Since Plus 1.7.0
The Viewshed layer is new in Plus 1.7.0, not released yet.
:::

## See it live

[Madrid's traffic cameras](https://pacha.ubica.dev/d/madrid-traffic-cameras), on the public demo instance: the city's
own list of its traffic cameras, what each one can see of the street among the buildings, and the picture it is
taking now.

![Central Madrid on a light base map: the street each of the 74 traffic cameras round Puerta del Sol can see within 250 m, from 10 m up, in blue along the avenues and squares, the streets no camera sees left blank, the camera picked ringed](/img/plus/viewshed-madrid.jpg)

## What the query needs

One row per observer, with its position. Everything else can be a fixed value for the whole layer instead of a column:

| Column              | Unit                         | Notes                                                          |
| ------------------- | ---------------------------- | -------------------------------------------------------------- |
| latitude, longitude | degrees                      | the observer; picked like any point layer's coordinates        |
| eye height          | metres above the ground      | a person's eyes, a camera's mast, a tower's top                |
| range               | metres                       | how far it sees, or any unit with a multiplier                 |
| azimuth             | degrees clockwise from north | where it looks                                                 |
| field of view       | degrees                      | how wide it looks; 360 or more is all round                    |
| a value             | anything                     | what the observer is coloured by: its name, its kind, a status |

```sql
-- Cameras on their masts, each looking one way.
SELECT camera,                -- the colour field: one colour per camera
       latitude, longitude,
       eye_m,                 -- the Eye height column
       range_m,               -- the Range column
       azimuth, fov           -- the Azimuth and Beamwidth columns
FROM cameras;
```

None of these is detected by name: pick each column in its group of the layer's settings, below. A Viewshed layer is
never created by itself: add one with **Add Layer** and pick **Viewshed** as the layer type, or switch a point layer
to it.

## What hides the view

**Hidden by** decides what stands between an observer and the ground:

| Setting                       | Hidden by                                   |
| ----------------------------- | ------------------------------------------- |
| **The terrain**               | the ground's relief: hills, valleys, ridges |
| **Buildings**                 | buildings on flat ground                    |
| **The terrain and buildings** | buildings standing on the relief            |

The terrain is [Mapterhorn](https://mapterhorn.com/)'s elevation, the tiles the Relief switch draws, read in the
browser round each observer, on any base map: about 19 m a pixel worldwide, down to 2 m where finer data exists.

### Buildings

**Buildings from** picks where the buildings come from:

- **The base map (OpenStreetMap)**, the default: OpenStreetMap's buildings with their heights, from the vector tiles
  of [OpenFreeMap](https://openfreemap.org/), read round each observer whatever base map the map shows, Google's
  satellite included. No dataset is needed. They are read within 3 km of each observer: past that, the terrain
  alone hides the view.
- **A dataset on the map** with a geometry column of polygons (GeoJSON, WKT or WKB, as for kepler's GeoJSON layer;
  see [Geometry](/guide/data/geometry)): your own footprints, a city's cadastre, Overture's buildings. The list shows
  the map's datasets that have one. The dataset can be drawn by another layer, or by none.

![St. Stephen's Cathedral in Vienna, its south tower's watchroom 68 m up: the streets and squares it sees within 700 m in orange, the rest of the old town's streets shaded, its roofs clear, the buildings OpenStreetMap's from the base map](/img/plus/viewshed-buildings.jpg)

A dataset's buildings take their height from **Building height**:

| Setting                | Height                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **By its name**        | a column named `height`, `render_height`, `building_height`, `height_m`, `hgt` or `h`, in metres; else one named `num_floors`, `building_levels`, `levels`, `floors` or `storeys`, times 3 m |
| a column               | that column, in metres, or times 3 m when it is one of the floor names                                                                                                                       |
| **One height for all** | **Height without one (m)** for every building                                                                                                                                                |

**Height without one (m)**, 10 by default, is the height of a building that has none, in a dataset or in
OpenStreetMap.

The building an observer stands in never hides its view: a camera on a façade or a mast on a roof sees out. Its
roofs, and every other roof, are left clear in the picture: the base map or the buildings' own layer draws them.

## Eye, target and the earth's curvature

- **Eye height** is how high the observer's eye is above the ground under it: 1.6 m for a person, a mast's or a
  camera's height. A column in metres, or **Eye height (m)** for every observer.
- **Eye from** (with buildings) is where that height counts from: **The ground**, or **Its roof**, the roof of the
  building the observer stands in, so a camera 3 m above a 20 m roof is a 3 m eye on **Its roof**.
- **Target height (m)** is how high above the ground a point must be seen: 0 for the ground itself, 1.6 for people,
  a car's or a turbine hub's height for where it shows. It repaints at once: each place keeps how high it would have
  to be to be seen, so the view is not worked out again.
- **Earth's curvature** lowers far points by the earth's curve, less the air's refraction (k = 0.13): 7 m at 10 km,
  27 m at 20 km. Leave it on past a kilometre.

## Range and field of view

The **Range** group takes a column, read as metres times **Multiplier** (1000 for a column in kilometres), or
**Range (metres)** for every observer: 10 m to 100 km, 2 km by default.

The **Field of view** group takes an **Azimuth** column and a **Beamwidth** column, the same as
[Coverage](./coverage)'s sectors. Without a column, **Azimuth (°)** is every observer's direction and **Field of
view (°)** its opening, 360 by default; with an azimuth column, **Azimuth (°)** is added to each row's value, to turn
a whole set of cameras at once.

## The picture

![Four cameras round Puerta del Sol in Madrid, each 6 m up on its stem, looking across the square with a 100° field of view: the street each sees in blue, strongest at the camera and fading towards its range, among Liberty's 3D buildings](/img/plus/viewshed-cameras.jpg)

- The ground an observer sees is painted in its colour, at kepler's opacity (0.6 for a new layer). Where several
  observers see the same ground, their colours pile up.
- **Shade what is hidden** shades the ground in range and in view but hidden, under every observer's seen ground.
- **Fade with distance** fades the seen ground from full at the observer to a fifth at the edge of its range, so the
  ground several observers see reads stronger.
- **Outline** draws each observer's range and field of view as a line in its colour.
- **Observer dot** marks each observer at its eye, on a stem from the ground in 3D. Its popup is its row.

On a relief base map the picture lies on the relief: with the terrain among what hides the view, on the heights the
view was worked out from; with **Buildings** alone, level with the ground at the observer. Pick **The terrain and
buildings** for buildings on a slope.

### The hover

Pointing at the picture tells what is seen there:

| Line           | Says                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Visibility** | whether the ground (or a target at the target height) is seen or hidden, and from how many observers |
| **Seen from**  | for a hidden place, how high above the ground or the roof a point there would have to be to be seen  |
| **Distance**   | how far the nearest observer that sees it is, or the nearest that has it in view                     |
| **Elevation**  | the terrain's height above the sea, with the terrain among what hides the view                       |

**Seen from** answers questions such as how tall a mast must be to show over a ridge, or from which floor of a
building a camera can see a corner. Past 1,000 m it says "More than 1,000 m".

## Options

After kepler's colour group come four groups of the layer's own, then **Interaction**.

### Observers

| Option                  | What it does                                                                          | Default |
| ----------------------- | ------------------------------------------------------------------------------------- | ------- |
| **Rows of the dataset** | each row of the layer's dataset is an observer                                        | on      |
| the observers           | places set in the layer, each its own colour and settings, dragged on the map (below) | none    |

### Line of sight

| Option                     | What it does                                                           | Default  |
| -------------------------- | ---------------------------------------------------------------------- | -------- |
| **Hidden by**              | The terrain, Buildings, or The terrain and buildings                   | terrain  |
| **Buildings from**         | The base map (OpenStreetMap), or a dataset on the map (with buildings) | base map |
| **Building height**        | By its name, One height for all, or a column (a dataset's buildings)   | by name  |
| **Height without one (m)** | the height of a building with none                                     | 10       |
| **Eye height**             | a column of eye heights, in metres                                     | none     |
| **Eye height (m)**         | every observer's eye, without a column                                 | 1.6      |
| **Eye from**               | The ground or Its roof (with buildings)                                | ground   |
| **Target height (m)**      | how high above the ground a point must be seen                         | 0        |
| **Earth's curvature**      | lowers far points by the earth's curve, less refraction                | on       |

### Range and Field of view

| Option                | What it does                                                 | Default |
| --------------------- | ------------------------------------------------------------ | ------- |
| **Range**             | a column of ranges                                           | none    |
| **Multiplier**        | metres per unit of the range column                          | 1       |
| **Range (metres)**    | every observer's range, without a column                     | 2000    |
| **Azimuth**           | a column of directions                                       | none    |
| **Azimuth (°)**       | every observer's direction, or an offset added to the column | 0       |
| **Beamwidth**         | a column of openings, in degrees                             | none    |
| **Field of view (°)** | every observer's opening, without a column                   | 360     |

### Look

| Option                                  | What it does                                                                  | Default |
| --------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| **Per place**                           | All rows, Last, Min or Max when an observer reports more than once            | Last    |
| **Asset**                               | the column that names a moving observer: Auto, None (by position) or a column | Auto    |
| **Detail**                              | Low, Medium or High: the cells across each observer's square (below)          | Medium  |
| **Fade with distance**                  | fades the seen ground towards the edge of the range                           | off     |
| **Shade what is hidden**                | shades the ground in range but hidden                                         | on      |
| **Outline**, **Outline width**          | the range and field of view as a line, its width in pixels                    | on, 1.5 |
| **Observer dot**, **Observer dot size** | a dot at each observer's eye, its radius in pixels                            | on, 4   |

**Per place** and **Asset** work as on [Coverage](./coverage#behaviour-worth-knowing): a time series keeps one
observer per place, and a moving observer (a patrol car's camera, a drone) is one observer that glides between its
reports and sees from wherever it is at the map's instant. kepler's filters, its time filter and a polygon drawn with
the draw tool choose the observers, as on the other Plus layers.

### Visible area

| Option            | What it does                                                                   | Default |
| ----------------- | ------------------------------------------------------------------------------ | ------- |
| **To a variable** | the name of a dashboard variable the ground seen is written to, as WKT (below) | none    |
| **Most vertices** | how many vertices the WKT may have before its outline is made coarser          | 300     |

### Interaction

kepler's **Allow hover** switch turns the hover above, and the observers' popups, on and off.

## Observers set in the layer

Places to look from can also be set in the layer itself, with no dataset of them: a camera to try, a lookout, a mast.
In the **Observers** group, **+ Add observer** puts one at the centre of the map, with a letter for a label and a
colour of its own; drag it on the map, and its view follows the pointer. Each row in the group sets an observer's
colour and label, and its own **Eye**, **Range**, **Azimuth** and **View** (its field of view): a field left empty
takes the layer's **Eye height (m)**, **Range (metres)**, **Azimuth (°)** or **Field of view (°)**. ✕ removes it.
They are saved with the map.

**Lat var** and **Lng var** name a pair of dashboard variables (text boxes, or any variable the other panels read): on
each drop the observer's position is written to them, once, so a query can use it (the cameras within its range, the
buildings it looks at); and a change from outside (a typed value, a table row's link, a shared URL) moves the
observer there. They work as the free panel's [markers](/guide/map/markers) do, with a view.

With **Rows of the dataset** off, only the observers set here look: a Viewshed layer on any dataset of the map becomes
a tool to try where a camera or a mast would see from.

## The ground seen, in the other panels

**To a variable** (in **Visible area**) writes the ground every observer of the layer sees to a dashboard variable,
so the other panels can query what is in sight: the shops a camera sees, the trees along the streets it covers, the
incidents no camera saw. The value is a `MULTIPOLYGON` in WKT, longitude and latitude (EPSG:4326) to six decimals,
the same ground the layer paints: seen at the **Target height**, the union of every observer's view, roofs left out.
It is written when the views change (a refresh, a filter, an observer dragged and dropped), once they have all been
worked out; `MULTIPOLYGON EMPTY` when the observers see nothing, and an empty value when the layer has none.

Make the variable a text box (it can be hidden), and use it in the other panels' queries. On the server's DuckDB:

```sql
-- The places in sight of the layer's observers.
SELECT name, category, longitude, latitude
FROM places
WHERE ST_Within(ST_Point(longitude, latitude), ST_GeomFromText(coalesce(nullif($visible, ''), 'MULTIPOLYGON EMPTY')))
```

A place inside a building (a shop's point often is) is under a roof, which is never part of the ground seen: widen
the area a few metres to take the buildings along the seen streets, `ST_Buffer(ST_GeomFromText($visible), 0.0001)`
(about 10 m in degrees), or move the points to the street.

Never use the variable in the Viewshed layer's own query: the observers would change the area, and the area the
observers, the way a drawn area must not filter its own map. Another query on the same map is fine: the places in
sight can be drawn over the views.

The variable travels in the dashboard's URL, and servers cut a URL at a few kilobytes (nginx at 8 KB a request line,
by default), which a shared link or a reload would hit. **Most vertices** keeps it short: past it, the outline is
traced on a coarser grid until it fits, and then the smallest pieces are left out. 300 vertices are about 6 KB;
raise it for finer outlines where the server allows longer URLs.

## Detail and how far it reaches

Each observer's view is worked out on a square of cells centred on it, as wide as its range each way: 129 cells
across at Low, 257 at Medium and 513 at High. A camera's 150 m at High is cells of under a metre; a lookout's 15 km
at Medium, cells of 117 m. The terrain is read at a zoom that suits the cells, down to Mapterhorn's zoom 15.

The cells of every observer on a map are shared out of one budget of 12 million: past 45 observers at High, or 181 at
Medium, each square gets fewer cells. A map draws at most 500 observers: the first ones kepler's filters keep.

The work runs in the browser, in a background thread, one observer after another, each one drawn as soon as it is
done. Terrain and building tiles are read once and shared by every map on the page.

## When it does not draw

An observer is skipped, without a message, when a column picked for its eye, range, azimuth or field of view is empty
or not a number, or its range works out at 0 metres or less.

Other things that look like a fault:

- **Nothing drawn for a while.** The terrain and building tiles round each observer load first; a few dozen
  observers with buildings can take some seconds the first time.
- **Everything in view is seen.** **Hidden by** is **Buildings** where there are none: the base map has few buildings
  mapped there, or the dataset picked has no polygons in that area.
- **A lookout sees less than it should.** The eye is too low (the default is a person's 1.6 m), or the range is
  short; with buildings, the observer may stand in a street canyon: try **Eye from: Its roof**.
- **Blocky edges.** The cells are too coarse for the zoom: raise **Detail**, shorten the range, or draw fewer
  observers.
- **Buildings far off do not hide.** The base map's buildings are read within 3 km of each observer.
- **3D tiles do not hide.** Google's 3D tiles and other tilesets are drawn, not read: only the terrain and building
  footprints hide the view.

## Use it for

Lookouts, fire towers and their blind spots, CCTV and traffic cameras among buildings, antenna and radio sites, where
a wind turbine, a mast or a new building will show, sightlines from a stage or a stand, security patrols.
