# What Plus adds

Plus is built from the free panel's source. Every feature of the free panel is in Plus, and every free option keeps
the same name and the same path in the panel's options and in the saved map. Everything on the free site, from
[What it is](/guide/what-it-is) to the option reference, stays true of a Plus panel. These pages cover only what
Plus adds.

## The free panel and Plus side by side

| Feature                                                                                                                        | Free panel | Plus |
| ------------------------------------------------------------------------------------------------------------------------------ | :--------: | :--: |
| kepler.gl layers, filters, time playback, saved map configuration                                                              |     ✓      |  ✓   |
| Column autodetection, GeoJSON, WKT and WKB geometry, H3                                                                        |     ✓      |  ✓   |
| Trips, origin–destination flows, symbols, streamlines, vector fields                                                           |     ✓      |  ✓   |
| Cloud-native imagery: COG, PMTiles, Zarr, WMS, ArcGIS Image Service, STAC                                                      |     ✓      |  ✓   |
| Dashboard time sync, cross-filtering, draggable markers, Grafana Assistant context                                             |     ✓      |  ✓   |
| OpenFreeMap, CARTO and Esri public base maps, with relief                                                                      |     ✓      |  ✓   |
| [Gauge, 3D Shape, Coverage, Surface, Sparkline, Traffic, Pipeline and Fleet layers](/plus/layers/)                             |            |  ✓   |
| [Places without coordinates](/plus/data/places): regions, zones, airports, PoPs, geohashes, countries, IPs                     |            |  ✓   |
| [States, provinces, counties and cantons](/plus/data/regions) placed by name or ISO 3166-2 code                                |            |  ✓   |
| [Network links](/plus/data/network-links) between named sites, coloured by Grafana thresholds                                  |            |  ✓   |
| [Active alerts](/plus/data/active-alerts) on the map, with only the rules the viewer can read                                  |            |  ✓   |
| [MapTiler, Esri, Azure Maps and Google base maps](/plus/maps/basemaps), keyed CARTO, Relief, POI and 3D building switches, sky |            |  ✓   |
| [Google Photorealistic 3D Tiles](/plus/maps/3d-tiles) layers                                                                   |            |  ✓   |
| Clicks and drawn polygons that also select and filter the Plus layers, and reach the other panels                              |            |  ✓   |
| Sparkline and Fleet cards that follow Grafana's shared crosshair from the other panels                                         |            |  ✓   |
| [Twelve template dashboards](/plus/start/templates) and [Grafana Assistant skills](/plus/assistant) for the Plus map           |            |  ✓   |

## Same options, same saved map

Because the options are the same, a free panel can be switched to Plus without losing anything: its options and its
saved map carry over. See [Move a dashboard to Plus](/plus/start/upgrade-a-dashboard).

Plus adds its own settings next to the free ones:

- in the panel options, the **Places** and **Active alerts** groups, and the **Thresholds**, **Unit** and
  **Decimals** standard options, which colour and label [network links](/plus/data/network-links);
- in kepler's side panel, the eight Plus layer types in the layer type list, the Plus base maps in the base map
  picker, and a **3D (Plus)** tab in **Add Data**.

Plus steps aside wherever the free panel already draws a query. A query with coordinates, a geometry or an H3 index
is drawn exactly as the free panel draws it; [Places](/plus/data/places) only acts on queries that name places
without giving their position.

## Which free version

Each Plus release is built on a released version of the free panel. [Versions](/plus/admin/versions) lists which
one, and the Grafana versions each release supports.
