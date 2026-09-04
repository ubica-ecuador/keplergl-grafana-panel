# Tutorials

Seven walkthroughs, each one a working dashboard you build from an empty panel. They are ordered so
that each assumes the one before it, but any of them can be read on its own.

Finished dashboards of the same kind — global seismicity, a wind field over the Andes, imagery on
the dashboard clock — are **[live at grafana.ubica.ec](https://grafana.ubica.ec/dashboards)**, open
to anyone as a read-only viewer. Worth a look before or after any of these.

| #   | Tutorial                                                 | Needs       | Teaches                                |
| --- | -------------------------------------------------------- | ----------- | -------------------------------------- |
| 1   | [Your first map](./first-map)                            | Infinity    | detection, styling, saving             |
| 2   | [Animate trajectories](./trajectories)                   | **nothing** | trip layers, playback, trail length    |
| 3   | [An origin–destination flow map](./od-flows)             | **nothing** | flow layers, magnitude, line style     |
| 4   | [A cross-filtered dashboard](./cross-filtered-dashboard) | Infinity    | filters and clicks driving variables   |
| 5   | [Click the map, query a radius](./click-to-query)        | DuckDB      | coordinate publishing, spatial queries |
| 6   | [A wind field](./wind-field)                             | DuckDB      | velocity fields, grid regularity       |
| 7   | [Imagery over time](./imagery-over-time)                 | **nothing** | WMS layers, the clock over imagery     |

## Data

Every tutorial uses **public data or nothing at all**, so you can follow them in any Grafana without
cloning this repository.

Tutorials 2, 3 and 7 need no data source whatsoever: they paste rows into Grafana's built-in
**TestData DB**, which is present in every install including Grafana Cloud. If you cannot install
plugins, start there — tutorial 7 gets a live satellite product onto the map out of two strings.

The rest use one of two data sources, both covered in [the recipes](../guide/sources/infinity):

- **[Infinity](https://grafana.com/grafana/plugins/yesoreyeram-infinity-datasource/)** — in the
  catalog, signed, installs from the plugin page. Fetches a URL.
- **[DuckDB](https://github.com/motherduckdb/grafana-duckdb-datasource)** — outside the catalog and
  unsigned, glibc only. Reads parquet, CSV, GeoJSON and JSON from anywhere, and can do arithmetic on
  the way through, which tutorial 6 depends on.

::: warning You need the panel installed first
All six assume **Kepler Geospatial Maps** is installed, on a Grafana in the supported range.
See [Install](../guide/install).
:::

## Third-party endpoints

Tutorials 1, 4, 6 and 7 call services this project does not control:

| Service                                                                                | Used by | Note                               |
| -------------------------------------------------------------------------------------- | ------- | ---------------------------------- |
| [USGS earthquake feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | 1, 4    | public, long-lived, no key         |
| [Open-Meteo](https://open-meteo.com/)                                                  | 6       | free tier, no key, fair-use limits |
| A demo GeoParquet endpoint                                                             | 5       | swap in your own file              |
| [GeoGLOWS](https://services.geoglows.org/geoserver/)                                   | 7       | public WMS, no key, time-aware     |

They were verified working when these pages were written. If one has moved, the shape of the
tutorial still holds — point it at an equivalent feed.

Be a reasonable citizen with the refresh interval on a public endpoint: a dashboard set to refresh
every ten seconds is a request every ten seconds, forever.

## If something does not render

Work through [Troubleshooting](../reference/troubleshooting) before assuming the tutorial is wrong.
The two most common causes by a distance are **the point radius being too small to see** and
**coordinate columns typed as strings**, which puts everything at (0, 0).
