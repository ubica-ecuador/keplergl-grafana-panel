# Template dashboards

Enabling the Plus app installs twelve dashboards. Each one is a working example of a Plus feature, with a starting
query and an **About** note on what to change to use your own data. Find them in Grafana's **Dashboards** list, or on
the app's **Dashboards** tab under **Administration → Plugins and data → Plugins**.

::: tip Copy before you customise
Grafana manages these dashboards with the app: it may replace them when the app is updated, and removes them when
the app is disabled. Save a copy with **Save as** before changing one.
:::

| Dashboard                                         | Shows                                                                                       | Documented in                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Service health map](#service-health-map)         | Synthetic Monitoring probes and the active alerts you can see                               | [Active alerts](/plus/data/active-alerts)                                  |
| [Service health history](#service-health-history) | The same probes replayed over the time range                                                | [Active alerts](/plus/data/active-alerts)                                  |
| [Network map](#network-map)                       | A link query as Traffic lines between sites, coloured by thresholds                         | [Network links](/plus/data/network-links), [Traffic](/plus/layers/traffic) |
| [Site gauges](#site-gauges)                       | Site utilisation as rings and temperature as thermometers                                   | [Gauge](/plus/layers/gauge)                                                |
| [3D shapes](#_3d-shapes)                          | Each site as a 3D bar, its height and colour from the metric                                | [3D Shape](/plus/layers/shape-3d)                                          |
| [Sensor surface](#sensor-surface)                 | Temperature estimated between weather stations, as bands and isolines                       | [Surface](/plus/layers/surface)                                            |
| [Fleet density](#fleet-density)                   | Vehicles within 500 m of each place, as bands and isolines                                  | [Surface](/plus/layers/surface)                                            |
| [Regions](#regions)                               | Provinces and counties placed by name, as a choropleth                                      | [States, provinces and municipalities](/plus/data/regions)                 |
| [Coverage](#coverage)                             | Cell sites by load per sector, and camera and radar fields of view                          | [Coverage](/plus/layers/coverage)                                          |
| [Coverage 3D](#coverage-3d)                       | Street light cones by lux, cell site signal domes, cameras and radar in 3D                  | [Coverage](/plus/layers/coverage#coverage-3d)                              |
| [Station trends](#station-trends)                 | A sparkline card per river station, coloured by band, with a no-data alert                  | [Sparkline](/plus/layers/sparkline)                                        |
| [Live fleet](#live-fleet)                         | Vehicles, drones, animals and devices at their last position, with replay and a vehicle cam | [Fleet](/plus/layers/fleet)                                                |

Several templates read synthetic data from Grafana's **TestData** data source. If your Grafana has none, add one
under **Connections**. The others query a Prometheus data source you pick in the dashboard's **Data source**
variable, and return nothing until you point them at your own metrics.

## Service health map

Your Synthetic Monitoring probes on the map, green while their checks pass and red when they fail, sized by how many
checks are failing now, with the firing and pending alerts you can see. Beside the map are an alert list and a table
of failing probes.

**Your data:** the probes need Synthetic Monitoring. Pick its Prometheus data source in **Data source**. Alerts are
placed by their own labels and come only from the rules your role lets you read; see
[Active alerts and service health](/plus/data/active-alerts).

## Service health history

The same probes replayed over the dashboard's time range, one point per probe and sample, with a reachability chart
by probe under the map. Press play on the map's time filter to animate the period.

**Your data:** as for the Service health map, pick the Synthetic Monitoring Prometheus data source in **Data
source**.

## Network map

A link query drawn as Traffic lines between the two ends of each row: comets run from source to target, faster where
the metric is higher, each end is a named dot, and each midpoint carries the metric with its unit. Line colours come
from the panel's **Thresholds**.

**Your data:** the query, `sum by (source, target) (link_mbps)`, returns nothing until you replace `link_mbps` with
your own link metric. The ends must be places [Places](/plus/data/places) recognises, such as regions or airport and
PoP codes. The saved layers fit a single frame with `source` and `target` columns; a node graph query's `nodes`
frame needs a layer added by hand. See [Network links](/plus/data/network-links).

## Site gauges

![Site utilisation in Europe: each city drawn as a ring filled to its value, green, amber or red, with its percentage in the middle and its name underneath](/img/plus/gauge.jpg)

Two maps: **Site utilisation**, each site as a ring filled to its share of the maximum, and **Site temperature**, each
site as a thermometer filled from −10 to 50 °C.

**Your data:** replace the placeholder metrics `utilizacion_pct` and `temperatura_c` with your own. Sites are placed
by their `site` label, so its values must be places Places recognises; sites with names of your own need `latitude`
and `longitude` columns instead. See [Gauge](/plus/layers/gauge).

## 3D shapes

![Utilisation per European city drawn as 3D cylinders in a tilted view, each one's height and colour taken from the same metric, green, amber or red](/img/plus/shape-3d.jpg)

Each site as a 3D bar whose height and colour both follow the metric, in a tilted view.

**Your data:** replace `utilizacion_pct` in `avg by (site) (utilizacion_pct)` with your own metric. Sites are placed
by their `site` label, as in Site gauges. See [3D Shape](/plus/layers/shape-3d).

## Sensor surface

Temperature estimated between 40 weather stations and drawn as coloured bands with isolines, with the stations as dots
on top. Values between stations are estimates, not measurements. Press play to watch the day go by.

**Your data:** replace the TestData query with your sensors: any table with latitude, longitude and a number, one
row per reading. See [Surface](/plus/layers/surface).

## Fleet density

![Count mode over Madrid: vehicles within 500 m drawn as coloured bands with labelled isolines, densest in the centre, with the vehicles as white dots on top](/img/plus/surface-count.jpg)

How many vehicles are within 500 m of each place, from 100 synthetic vehicles in Madrid reporting once an hour. Press
play to watch them leave the depots, crowd the centre at rush hour and come back at night.

**Your data:** replace the TestData query with your own fleet: any table with a time, a vehicle id, latitude and
longitude, one row per position. See [Surface](/plus/layers/surface).

## Regions

Two choropleths without coordinates: **Sales by province**, Ecuador's provinces placed by name, and **Cases by
county**, United States counties placed by county, state and country code.

**Your data:** replace the TestData queries with your own. A query is placed when it has a `state`, `province` or
ISO 3166-2 code column, or a `county`, `canton` or `municipio` column with a country column, and a state column
where the same county name exists in several states. With no country column, choose the country in the panel's
**Places → Country** option. See [States, provinces and municipalities](/plus/data/regions).

## Coverage

![Six cell sites in Cuenca drawn as three sectors each, every sector coloured green, amber or red by its load and fading towards its edge](/img/plus/coverage.jpg)

Two maps on built-in test data: **Cell sites**, coloured by load per sector, and **Cameras and radar**, with their
fields of view.

**Your data:** swap a panel's query for your own. The layers keep their settings as long as your columns have the
same names. See [Coverage and Coverage 3D](/plus/layers/coverage).

## Coverage 3D

![Street lights along a few blocks drawn as 3D light cones, yellow or orange by lux and red where a light has failed](/img/plus/coverage-3d-lights.jpg)

Three maps in 3D: **Street lights** as light cones coloured by lux, **Cell sites** as signal domes coloured by load,
and **Cameras and radar** with their fields of view.

**Your data:** as for Coverage, swap the query and keep the column names. See
[Coverage 3D](/plus/layers/coverage#coverage-3d).

## Station trends

![River stations in Cuenca drawn as sparkline cards with their turbidity over the day, each value in its band's colour, and one station in red with No data and a blinking button](/img/plus/sparkline.jpg)

Each river station as a sparkline card with its turbidity over the day, its current value in its band's colour, and a
time series of the same stations under the map. One station stops reporting at 17:00, so its card turns red with
**No data**. Hover the graph to see the cards follow Grafana's shared crosshair.

**Your data:** the data is a fixed day, 1 September 2026 in UTC, and the dashboard's time range is set to it. Query
rows with a position, a time and a value, then set the dashboard back to a relative time range. Grafana thresholds do
not reach the map: edit the bands in the layer's colour range. See [Sparkline](/plus/layers/sparkline).

## Live fleet

![A live fleet in a city: each vehicle at its last position with its heading, status colour and a short trail; one marked as silent](/img/plus/fleet.jpg)

Three maps over the same synthetic fleet of cars, vans, trucks, buses, bicycles, drones and a herd of cattle: **Live
fleet**, each asset once at its position now; **Replay**, which moves the fleet when you press play on the time
filter; and **Vehicle cam**, which follows the vehicle chosen in the **Vehicle** variable from behind.

**Your data:** a table with an asset id (`vehicle_id`, `device_id`, `imei`, `mmsi`…), a time and a position, or one
series per metric and asset with the asset as a label. Switch the data source variable and keep the panels. For
Vehicle cam, also set the **Vehicle** variable to your asset ids and move its time window to your data's range, since
its time sync is off. See [Fleet](/plus/layers/fleet).
