# Changelog

1.0.0 is the first release submitted to the Grafana plugin catalog, so there is no earlier release
for it to be a change against — the entry below lists what the plugin **does**, not what changed to
get it there. From 1.0.0 onwards, each release documents what changed since the one before it.

## 1.0.0 (2026-09-01)

Interactive kepler.gl maps inside Grafana dashboards, fed by any Grafana data source: points,
trajectories, origin-destination flows and animated velocity fields built straight from a query's
columns; cloud-native imagery walked by the dashboard clock; and five cross-filtering channels
wiring the map into the rest of the dashboard through variables. No account and no Mapbox token are
needed for any base map.

### Data in

Any Grafana data source works — the panel reads data frames, not a specific protocol.

- Each query becomes one kepler dataset, identified by its `refId`, so a single panel can overlay
  several — a road network over a heatmap over a set of trajectories.
- Column autodetection for latitude/longitude, time, trip id, geometry and H3, overridable per
  query under **Field mapping** — including switching a detected role off, which is how a
  trajectory table is drawn as loose points instead of trips.
- Geometry from GeoJSON, WKT, or raw WKB/EWKB hex, so a plain `SELECT geom` from PostGIS renders
  with no `ST_AsGeoJSON` wrapped around it.
- H3 indices and S2 tokens both render without coordinates — the grid cell's own identifier is the
  geometry. H3 also drives origin-destination flows, as a pair of hexagons instead of two
  coordinate pairs.
- EPSG:4326 only. The panel renders WGS84 longitude/latitude degrees and does not reproject;
  project in the query if the source is not already in it.

### Layers the panel builds for you

- **Points**, from a latitude/longitude pair or a geometry column — kepler's own detection, no
  layer setup needed.
- **Trips**, from a trip id, a time and a position: an animated Trip layer with a playback
  timeline. Table-column mode (the default) keeps one row per point and every other column with
  it, for colour, filters and tooltips; GeoJSON mode folds each trip into a single row carrying
  only the path, far smaller for a large trajectory table.
- **Origin-destination flows**, from a pair of coordinate pairs or a pair of H3 indices, drawn
  straight, curved, or animated.
- **Velocity fields**, from a grid of speed and direction, or of u/v components — GRIB2's
  `ugrd`/`vgrd` included — as a **Flow field** layer that traces streamlines through the grid. It
  has a panel of its own: density, zoom response, stroke width, trail length, line length, cycle,
  lifetime, seamless looping, smoothing, height and vertical exaggeration, next to a colour ramp
  applied to each line's mean speed. The field re-traces as the map is panned or zoomed, so its
  density and length hold steady at any tilt or bearing, and several levels can be stacked in the
  vertical.

### Imagery

A query can return the address of imagery instead of rows, and the panel draws it: **COG,
PMTiles, Zarr, WMS, and ArcGIS Image Services.**

- A COG or a Zarr store is read by a **tile server** — a TiTiler-compatible service named by the
  **Raster tile server** option, which reads the imagery on the map's behalf. It defaults to a
  public third-party demo (`https://titiler.xyz`), good enough to draw a public scene
  unconfigured, but it cannot see anything private and is handed every URL it is pointed at. A
  **PMTiles** archive needs no server at all — the browser reads it directly over range requests —
  and neither does a **WMS**, which is already a rendering service, or an **ArcGIS Image
  Service**, which the browser reads directly from Esri's endpoint.
- Return one row per date, or per moment, and the dashboard clock walks the series: dragging the
  timeline changes the picture in place, without re-running the query or rebuilding the layer — a
  scene, a Zarr slice, a WMS date, or an ArcGIS Image Service mosaic rule alike.
- A polygon or rectangle drawn on the map can be **measured**, not only drawn, over a COG or a
  Zarr store, with no second query — the same tile server that draws the imagery also answers
  statistics over the shape you drew or the point you clicked.
- Colour: eight named ramps, or a whole TiTiler interval definition typed in as JSON — the only way
  to fade the low end to transparent, which a field that is mostly near zero needs. A classified
  raster — land cover, soils — can be handed to the tile server to paint instead, since its colours
  are a fact of the data and no ramp can express them.

### The map

- Base maps with **no account needed**: Carto's three, Esri satellite and topographic, and two of
  those with real elevation — tilt the camera and the ground rises. The Mapbox-only styles that
  would blank the map on click are not offered at all.
- A self-hosted MapLibre `style.json`, for an air-gapped install or to skip Esri's and Carto's
  terms of use entirely.
- Follows the dashboard theme, base map included.
- **WebGL 2** required — everything the map draws goes through deck.gl, with no canvas or SVG
  fallback. Each map holds two WebGL contexts, so the practical ceiling is around eight maps on one
  dashboard page.
- **Saved map configuration**, stored with the dashboard: layers, styling, filters, interactions,
  split state, base map. Configs pasted from kepler.gl, Foursquare Studio or Dekart are accepted,
  and a layer added by hand through kepler's own **Add Data → Tileset** is saved as a lightweight
  descriptor rather than as data.
- **Split view** — two synchronised panes with different layers visible in each, or a swipe
  curtain between them.
- Layer configuration survives a data refresh: rows are swapped in under the layers rather than the
  dataset being torn down and rebuilt.

### Dashboard integration

- **Time range sync**, in three modes: the dashboard drives the map's time filter one way, both
  directions couple them, or the slider's window publishes to two dashboard variables so the map
  keeps its whole dataset while the rest of the dashboard follows the slider.
- Maps on a dashboard can **share a clock** with each other — time filter and trip playhead alike —
  over an in-browser channel, with no dashboard variable and no query re-run.

### Cross-filtering

Five channels, wired under **Cross-filtering**, each writing to a dashboard variable for the rest
of the dashboard to read:

- **Filter** — a select, multi-select or text filter set on the map, both ways; a numeric range
  filter publishes as a min/max pair the same way.
- **Click** — the clicked entity's value of a column, map to variable.
- **Coordinate** — the clicked place, as a lat/lng variable pair. The same pair can also be read
  back the other way, to recentre the map from outside it — a table row's data link, a pair of
  text boxes — at an optional zoom.
- **Drawn area** — the polygon or rectangle drawn on the map, as WKT.
- **Viewport** — the map's own bounding box, published for the *other* panels on the dashboard;
  feeding it back into the map's own query would only ever shrink what the map has to show.

---

The 0.1.0, 0.2.0 and 0.3.0 series that came before 1.0.0 was developed on GitHub and never
published to the Grafana plugin catalog. Its record is in the git history rather than here.
