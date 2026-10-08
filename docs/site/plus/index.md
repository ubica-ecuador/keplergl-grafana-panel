# Kepler Geospatial Maps Plus

Plus is the edition of Kepler Geospatial Maps for operations maps: sensors, sites, network links and fleets, each
drawn where it is together with its own time series. A gauge fills over each substation, a sparkline card sits over
each river station, comets run along each link at its traffic's pace, and each vehicle moves with its trail. Press
play and the whole map walks through the dashboard's time range.

![European power grid on one map: renewable share as gauges, demand as 3D bars, interconnector flows as Traffic links](/img/plus/european-grid.jpg)

Plus runs the free panel with everything it does, under the same options, and adds to it. Free and Plus panels can
run side by side on the same Grafana and the same dashboard.

## What it adds

- [Eight layer types](/plus/layers/): Gauge, 3D Shape, Coverage, Surface, Sparkline, Traffic, Pipeline and Fleet.
- [Places without coordinates](/plus/data/places): cloud regions, airports, PoPs, geohashes, countries and client IPs
  placed from their names, and [states, provinces and municipalities](/plus/data/regions) placed by name or
  ISO 3166-2 code.
- [Network links](/plus/data/network-links) between named sites, and the
  [active alerts](/plus/data/active-alerts) the viewer can read, on the same map as your data.
- [Base maps](/plus/maps/basemaps) from MapTiler, Esri, Azure Maps, Google and keyed CARTO, and
  [3D tiles](/plus/maps/3d-tiles) from Google, with keys set once for the organisation.
- A [layer tour](/plus/start/templates) dashboard installed with the app, on synthetic data that needs no setup.
- [Grafana Assistant skills](/plus/assistant) that explain a Plus map, edit it and build dashboards around it.

[What Plus adds](/plus/start/what-plus-adds) compares the two editions feature by feature.

## Requirements

Plus needs Grafana Cloud or Grafana Enterprise, at one of these versions:

- 12.0.10 or a later 12.0 patch;
- 12.1.7 or a later 12.1 patch;
- 12.2.5 or any later version.

These are the free panel's floors too; the free [Install](/guide/install#requirements) page explains why.

Plus is an app plugin, **Kepler Geospatial Maps Plus** (`ubica-keplerplus-app`). Install it from Grafana's plugin
catalogue and enable it, and its panel, also called **Kepler Geospatial Maps Plus**, appears in the visualization
picker. See [Install and configure the app](/plus/start/install).

## Where to go next

- [Install and configure the app](/plus/start/install), then add the keys of the map services you use.
- [Move a dashboard to Plus](/plus/start/upgrade-a-dashboard) to switch a free panel without losing its map.
- Open the [layer tour](/plus/start/templates) and replace a map's query with your own.
- The [free panel's documentation](/guide/what-it-is) covers everything Plus inherits: queries, kepler's layers,
  filters, time playback and the links to the rest of the dashboard.
