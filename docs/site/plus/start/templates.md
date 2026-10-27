# Template dashboards

Enabling the Plus app installs three dashboards, the **Kepler Plus tour**: every Plus layer, kepler's own layers and
the free panel's, and the ways a map talks to the rest of a dashboard. Find them in Grafana's **Dashboards** list
(tag `kepler-plus-tour`), through the **Tours** menu at the top of each, or on the app's **Dashboards** tab under
**Administration → Plugins and data → Plugins**.

| Dashboard                                      | Shows                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Kepler Plus tour — Plus layers](#plus-layers) | Gauge, 3D Shape, Traffic, Pipeline, Fleet, Coverage 3D, Sparkline, Surface and regions placed by name |
| [Kepler Plus tour — Map layers](#map-layers)   | Streamlines, wind barbs, Symbol, Markers and kepler's layers, with keyless imagery                    |
| [Kepler Plus tour — Interaction](#interaction) | The Time Brush, click selection, fit to data and a drawn area, all through dashboard variables        |

Every map reads synthetic rows carried inside its dashboard by Grafana's built-in **-- Grafana --** data source,
which every Grafana has, Grafana Cloud included, so the tours draw the moment the app is enabled, with nothing to set
up. The one place they cannot work is a public (shared) dashboard: Grafana runs a public dashboard's queries on the
server, and the server has no rows to give.

The data is a fixed day, 1 September 2026 in UTC, and each dashboard's time range is set to that day. Each map keeps
its own time filter: press ▶ on it to replay the scenario.

::: tip Copy before you customise
Grafana manages these dashboards with the app: it may replace them when the app is updated, and removes them when the
app is disabled. Save a copy with **Save as** before changing one.
:::

## Plus layers

The layer tour: six maps, one per scenario.

| Map                                | Shows                                                                                 | Documented in                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Power grid — Europe](#power-grid) | Renewable share as gauges, demand as cylinders, interconnector flows as Traffic lines | [Gauge](/plus/layers/gauge), [3D Shape](/plus/layers/shape-3d), [Traffic](/plus/layers/traffic), [Network links](/plus/data/network-links) |
| [City — Cuenca](#city)             | A fleet in 3D at its last position, over cell site domes and camera and radar cones   | [Fleet](/plus/layers/fleet), [Coverage 3D](/plus/layers/coverage#coverage-3d)                                                              |
| [Rivers — Cuenca](#rivers)         | A sparkline card per river station, with a no-data alert and a shared crosshair       | [Sparkline](/plus/layers/sparkline)                                                                                                        |
| [Weather — Madrid](#weather)       | Temperature estimated between weather stations, as bands and isolines                 | [Surface](/plus/layers/surface)                                                                                                            |
| [Regions — Ecuador](#regions)      | Ecuador's provinces placed by name, as a choropleth                                   | [States, provinces and municipalities](/plus/data/regions)                                                                                 |
| [Networks — Iberia](#networks)     | A gas line, a two-way power line and a river, animated along their routes             | [Pipeline](/plus/layers/pipeline)                                                                                                          |

The dashboard's **About this dashboard** panel repeats what each map shows and what to change to use your own data.

More dashboards built with Plus, on live public data, are on the
[live demos](https://pacha.ubica.dev/dashboards/f/plus/?orgId=1), public and read-only.

### Power grid

![Sixteen European countries with a gauge for their renewable share, a cylinder for their demand, and comets running along the interconnectors between them](/img/plus/european-grid.jpg)

Sixteen European countries over a winter day's pattern: a **Gauge** ring filled to each country's renewable share, a
**3D Shape** cylinder as tall as its demand, and **Traffic** comets along the interconnectors, coloured by load, which
change direction through the day.

**Your data:** two queries. The links are a frame with `source` and `target` columns, a time, the power `mw` and the
`load` in percent, with a frame of nodes that gives each end an `id` and its coordinates. The country readings are rows
with a time, a position, `demand_mw` and `renewable_pct`. See [Network links](/plus/data/network-links) for the link
shapes Plus accepts.

### City

![A live fleet in a city: each vehicle at its last position with its heading, status colour and a short trail; one marked as silent](/img/plus/fleet.jpg)

A synthetic fleet of cars, vans, trucks, buses, bicycles, drones and a herd of cattle over the last hour of the day,
drawn by the **Fleet** layer in 3D: each asset once, at its position now, turned to its heading, with a short trail and
a bundled model for its type. Three of them have stopped reporting and turn grey. Under them, **Coverage 3D** raises
the cell sites as signal domes coloured by load, and the cameras and the radar as cones. The map is tilted: drag with
the right mouse button to turn it.

**Your data:** for the fleet, a table with an asset id (`vehicle_id`, `device_id`, `imei`, `mmsi`…), a time and a
position, or one series per metric and asset with the asset as a label. For coverage, one row per sector with its
position, `azimuth`, `beamwidth` and `range_m`. The layers keep their settings as long as your columns have the same
names.

### Rivers

![River stations in Cuenca drawn as sparkline cards with their turbidity over the day, each value in its band's colour, and one station in red with No data and a blinking button](/img/plus/sparkline.jpg)

Six river stations, each a **Sparkline** card with its turbidity over the day and its current value in its band's
colour. One station stops reporting at 17:00, so its card turns red with **No data**. The Time series under the map
reads the same query; hover it to see every card follow Grafana's shared crosshair.

**Your data:** rows with a position, a time and a value, one row per reading. Grafana thresholds do not reach the map:
edit the bands in the layer's colour range.

### Weather

Temperature estimated between 40 weather stations around Madrid by a **Surface** layer in Interpolate mode, drawn as
coloured bands with isolines, with the stations as dots on top. Values between stations are estimates, not
measurements. Press ▶ to watch the day go by.

**Your data:** any table with latitude, longitude and a number, one row per reading. The layer's Count mode instead
counts the points within a radius of each place, for vehicles or events.

### Regions

Ecuador's 24 provinces placed by name, from a query with a `country` and a `province` column and no coordinates,
drawn as a choropleth.

**Your data:** a query is placed when it has a `state`, `province` or ISO 3166-2 code column, or a `county`, `canton`
or `municipio` column with a country column. With no country column, choose the country in the panel's
**Places → Country** option.

### Networks

A gas line, a power line that carries load both ways and a river across Spain and Portugal, each drawn by the
**Pipeline** layer along its real route, with the speed and width of its flow; the power line runs in two lanes.

**Your data:** one row per line, with a line geometry column (GeoJSON, WKT or WKB) and the metric that drives the
flow; two metrics for a line that carries load both ways.

## Map layers

Six maps of kepler's own layers and the free panel's, all part of Plus too. Open a map's layer panel (the arrow at its
top left) to see how each layer reads its columns.

| Map                | Shows                                                                                         | Documented in                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Wind — Ecuador     | Streamlines and wind barbs on a wind lattice, Symbol arrows at stations, a draggable Marker   | [Velocity fields](/guide/data/velocity-fields), [Symbols](/guide/data/symbols), [Markers](/guide/map/markers) |
| Districts — Cuenca | GeoJSON polygons over H3 cells, with Icon places                                              | [Geometry](/guide/data/geometry), [H3 and S2](/guide/data/h3-and-s2)                                          |
| Incidents — Cuenca | Hexagon and Grid in 3D on a split map, and a Heatmap under Cluster bubbles                    | [Layers and attributes](/guide/kepler/layers-and-attributes), [Points](/guide/data/points)                    |
| Imagery — Ecuador  | Sentinel-2 land cover from an ArcGIS Image Service, under daily rainfall from a WMS with time | [ArcGIS Image Service](/guide/data/arcgis-image-service), [WMS](/guide/data/wms)                              |
| Travel — Ecuador   | Flights as arcs, bus links as lines, and four buses replayed by the Trip layer                | [Flows](/guide/data/flows), [Trajectories](/guide/data/trajectories)                                          |

The two imagery layers read public services that need no key. Left out are the layers that need a tile server of
your own (Zarr, painted COGs and raster tiles through TiTiler) and 3D tiles, which need a key: see
[Rasters](/guide/data/rasters), [Zarr](/guide/data/zarr) and [3D tiles](/plus/maps/3d-tiles).

## Interaction

Four ways a map talks to the rest of a dashboard, all through dashboard variables, so a shared link carries the state.

| Map                   | Shows                                                                                                         | Documented in                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Earthquakes — Ecuador | The Time Brush across the top writes its window to two variables, and the map shows only that window          | [Time Brush](/plus/time-brush), [Time window variables](/guide/dashboard/time-window-variables)                                                                                  |
| Air quality — Cuenca  | A click selects a station, Shift+click adds one, the rest dim, and a chart keeps the stations selected        | [Click](/guide/dashboard/cross-filtering), [Dim the rest](/guide/dashboard/cross-filtering#dim-the-rest)                                                                         |
| Health — Ecuador      | Picking a province frames the map on it, with the centres the query flags highlighted                         | [Fit to data](/guide/dashboard/cross-filtering#fit-to-data-when-a-variable-changes), [A selection the query flags](/guide/dashboard/cross-filtering#a-selection-the-query-flags) |
| Transit — Quito       | An area drawn on the map is written to a variable as WKT, and a WKT typed in the variable is drawn on the map | [Drawn areas](/guide/dashboard/publishing#drawn-areas)                                                                                                                           |

A table under the maps shows what each variable holds as you try them.

## Your own data

Replace a map's query with your own rows of the same shape, then set the dashboard back to a relative time range.
Colours follow kepler's breaks, edited in each layer's colour range. Each layer's page lists the columns it reads.
