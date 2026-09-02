# Changelog

1.0.0 is the first release submitted to the Grafana plugin catalog, so there is no earlier release
for it to be a change against — the entry below lists what the plugin **does**, not what changed to
get it there. From 1.0.0 onwards, each release documents what changed since the one before it.

## Unreleased

### Changed

- **kepler.gl moves from `3.3.0-alpha.7` to `3.3.0-alpha.9`**, which is now the `latest` tag on npm.
  There is still no stable 3.3.0, so the pin stays exact. What it brings: kepler registers a
  twenty-first layer type, `geohash`, alongside the `a5` grid-index layer it already had — neither
  is detected from a column, so both are added by hand like the URL-configured layers; kepler's own
  packages drop their nested `lodash` copies for `es-toolkit`; and deck.gl and loaders.gl advance by
  a patch. The declared dependency set is otherwise unchanged, and the bundle is the same size to
  within a tenth of a megabyte.

  What it does **not** bring is a fix for any of the four upstream defects this plugin works around.
  All four were re-read in the installed alpha.9 and are unchanged: the Trip layer's value accessor
  still takes the feature alone (`tripLayerFix`), the incremental animation still discards the
  remainder instead of clamping (`animationSweepFix`), the histogram still paints its brush before
  its bars (`rangeBrushFix`), and the WMS layer still hands deck a plain url with no `TIME`
  (`wmsTimeLayer`). The four modules stay, and so do the notes saying when to delete them.

### Added

- **A Grafana 13 bench on port 3003** (`grafana-13` in `docker-compose.yaml`). `grafanaDependency`
  has no upper bound, so every 13.x install offers this plugin, and 13 is where React 18 becomes
  React 19 — which `@grafana/react-detect` reports the plugin as incompatible with, entirely because
  of packages inside kepler's tree that are in the built archive. The other three benches all sit at
  the floor of the supported range; this one is the ceiling, so the claim can be tested rather than
  assumed.

  It is now tested: the full end-to-end suite passes **48/48** against Grafana 13.2.1, so the
  react-detect report is a false positive in practice. The one gap is react-color's `defaultProps`,
  the only finding that is a real behavioural change rather than a legacy API React 19 merely
  ignores — no spec opens kepler's colour picker, so it was opened by hand instead; it renders and
  throws nothing.

- **Signing wired into the release workflow for both sides of the catalog review.** A plugin that
  has never been published cannot be signed — the signature level is granted by the review — so the
  archive submitted for review has to be unsigned, and is. The token is passed unconditionally
  regardless, because the action skips its own sign step on an empty one; adding
  `GRAFANA_ACCESS_POLICY_TOKEN` to the repository secrets after approval turns signing on with no
  further edit.

### Fixed

- The documentation said kepler registers **nineteen** layer types. It registered twenty at
  `alpha.7` and registers twenty-one at `alpha.9` — the count had never accounted for `a5`. The
  arithmetic on the layer pages now closes: thirteen driven from query columns, six configured with
  a URL, two grid-index layers the panel does not detect.

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
- A polygon or rectangle drawn on the map, or a coordinate clicked on it, publishes to a dashboard
  variable — and a separate panel can turn that into a number over a COG or a Zarr store: an
  Infinity query calling the same tile server's statistics route, with no ETL, no database, and no
  second copy of the data.
- Colour: eight named ramps, or a whole TiTiler interval definition typed in as JSON — the only way
  to fade the low end to transparent, which a field that is mostly near zero needs. A classified
  raster — land cover, soils — can be handed to the tile server to paint instead, since its colours
  are a fact of the data and no ramp can express them.

### The map

- Base maps with **no account needed**: Carto's three, and Esri's three — flat satellite imagery,
  and satellite and topographic imagery over real elevation, where tilting the camera lifts the
  ground; topographic exists only in this relief form, with no flat version. The Mapbox-only
  styles that would blank the map on click are not offered at all.
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
