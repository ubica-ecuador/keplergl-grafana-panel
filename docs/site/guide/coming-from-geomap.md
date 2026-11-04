# Coming from Geomap

Grafana's own map panel, Geomap, and this one read the same queries. A Geomap panel can be switched
to Kepler in place, and the map comes with it: its layers, colours, view and base map, rather than
whatever the panel would guess from the columns.

## Switching

Edit the Geomap panel, open the visualization picker, and choose **Kepler Geospatial Maps** (or
**Kepler Geospatial Maps Plus**). Then save the dashboard.

The conversion happens in two steps, and the second needs the queries to answer. The first reads
Geomap's options; the second, on the first rows, builds the kepler layers on the columns the rows
actually have — Geomap's usual location mode names no column, so they cannot be known before. A
panel whose queries return nothing waits until they do. A Geomap that only draws files, a GeoJSON
over the base map, converts at once.

If anything had no counterpart, a notice says so right after the switch. It is shown once, to the
person who switched, and not saved with the dashboard.

## What comes across

| In Geomap                        | In Kepler                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markers                          | a Point layer: colour (fixed, by thresholds, or by a continuous or palette scheme), size and size by field, opacity, outline, text labels, the legend                                                                                                                                                       |
| Heatmap                          | a Heatmap layer, its radius matched to Geomap's radius and blur at the zoom the map opens on, coloured by the weight field's scheme                                                                                                                                                                         |
| Route                            | a Line layer on the query's rows joined in order, with colour, width and arrows. See [Routes and networks](./data/routes-and-networks)                                                                                                                                                                      |
| Network                          | the nodes as a Point layer and the edges as a Line layer between them. See [Routes and networks](./data/routes-and-networks#networks)                                                                                                                                                                       |
| GeoJSON                          | a GeoJSON layer on the file, which kepler fetches by its address on every load. Style rules carry over when they all check one property                                                                                                                                                                     |
| Photos                           | a Photos layer: each row's picture in a square or round frame                                                                                                                                                                                                                                               |
| XYZ and ArcGIS tile layers       | an XYZ tiles layer in the same place in the stack. See [Layers configured with a URL](../layers/url-configured#xyz-tiles)                                                                                                                                                                                   |
| Night / Day                      | the panel's [night shading](./map/night-shading), with Geomap's colour and sun                                                                                                                                                                                                                              |
| Location by coordinates or auto  | the same columns, through [Field mapping](../reference/field-roles)                                                                                                                                                                                                                                         |
| Location by geohash or by lookup | the same column, and the same gazetteer. Markers stay at the centre of each cell, as Geomap draws them; for the cells themselves, add a GeoHash layer. See [Places by geohash or by name](./data/places-by-name)                                                                                                                                                                                                          |
| Base map                         | the closest one the panel offers: CARTO light and dark become OpenFreeMap's, OpenStreetMap becomes Liberty, Esri World Imagery the panel's satellite map, a MapLibre style URL a custom style. A tiled base map with no counterpart (XYZ, Esri's other services) is drawn as tiles at the bottom of the map |
| View                             | the same centre, one zoom level lower (OpenLayers counts on 256-pixel tiles, MapLibre on 512); preset regions included; **Fit to data** frames the rows                                                                                                                                                     |
| Layer order                      | kept: Geomap lists its layers bottom up and kepler top down, so the list is reversed                                                                                                                                                                                                                        |
| Tooltip                          | on or off                                                                                                                                                                                                                                                                                                   |

Two choices are made for you, both to keep the map looking as it did:

- **The side panel starts hidden.** A Geomap tile shows the map and nothing else.
- **Time range sync is off.** Geomap draws every row its queries return; the dashboard's range
  reaches it only through the queries. Turn it on under **Map → Time range sync** if you want the
  map's clock coupled to the dashboard. See [Time range sync](./dashboard/time-range-sync).

## Where it will look different

Sizes are converted to look the same on screen, but kepler draws in different units from
OpenLayers, and a few things show it:

- **Points and outlines are drawn in metres** and scaled with the zoom, so near the poles they grow,
  where Geomap's stay the same number of pixels. A world map also cannot zoom out past the height of
  the panel, so at world scale points look larger than Geomap's.
- **Labels** sit beside their point, on the side Geomap's offset pointed to, but a little further
  away: kepler places them by anchor and alignment and ignores an offset.
- **A route's colour** changes at each row rather than blending along the segment.
- **A wide picture** is not cropped to its photo frame.
- **The attribution** in the corner names the panel's base map, not the tiles drawn over it.

## What does not come across

- **Icon at last point** (`last-point-tracker`), an alpha layer in Grafana. In Kepler Plus the
  [Fleet](../plus/layers/fleet) layer shows each asset's latest position, with its trail.
- **A location mode Geomap may add** after this was written.

## Afterwards

The converted map is an ordinary saved kepler configuration: change it in kepler's own panel and
**Save map**, as for any other map. See [Map configuration](./map/map-configuration).
