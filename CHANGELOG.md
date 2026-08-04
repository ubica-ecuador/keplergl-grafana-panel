# Changelog

All notable changes to this plugin are documented here. Versions before 1.0 ship as GitHub
releases; 1.0 is the first Grafana catalog submission and is blocked on a stable kepler.gl 3.3.0.

## Unreleased

- **Maps on a dashboard can share a clock.** The new **Sync time with other maps** switch under *Map*
  puts a panel on an in-browser channel with every other panel that has it on: playing an animation
  on one moves the rest. Both of kepler's clocks travel — the time filter window and the trip
  playhead — and neither the dashboard time range nor the database is touched, so an animation costs
  nothing. Reaching the same effect through `bidirectional` mode was possible but expensive: it moves
  the dashboard range, which re-runs every query on every frame — 92 queries in ten seconds on a
  two-panel dashboard, against 0 through the channel.

- **Trip queries keep their columns.** A trajectory query is no longer folded into one row per trip
  carrying nothing but a geometry. The rows are passed through as they come — speed, mode of
  transport, staypoint id, every column the query returned — and the panel adds a Trip layer in
  kepler's table column mode, which groups the rows into paths itself. Tooltips, filters and colour
  now work on the points of a trip. Where kepler guesses a Trip layer of its own — it does that for
  any dataset with a column named `id` — the panel's layer replaces it.
- **Trip layer shape is selectable.** The new **Trip layer** option under *Map* chooses between
  `Table columns` (the default, above) and `GeoJSON`, which folds each trip into a single row
  carrying only the path. GeoJSON is the cheaper shape for large trajectory tables — tens of rows
  instead of hundreds of thousands — gives a predictable one-colour-per-trip, and is what map
  configurations saved before this release point at, so an existing trip panel keeps working by
  switching to it.
- **Roles can be switched off.** Every field in **Field mapping** gains a **None** option, so a role
  the plugin detected can be disabled instead of only redirected. Setting **Trip ID** to None is what
  loads a trajectory table as timestamped points — one row per fix, with every column of the query
  available for colour, filters and tooltips — rather than folding it into one path per trip.
- **Fixed** the saved map configuration never capturing the current view. The panel compared the
  saved config by object identity, but Grafana rebuilds the options object on every change — so
  clicking **Save current map configuration**, itself an options change, rebuilt the map from the
  stored config first and then snapshotted that restored viewport. Saving now keeps the map the user
  is looking at, and unrelated option changes no longer reset it.
- **Fixed** trip layers vanishing as soon as the map was zoomed in. An `elevation` column was
  auto-mapped to the path's third coordinate, and deck.gl reads that as height above ground: a trace
  through Cuenca at 2,650 m was drawn 2.65 km up and fell out of the camera's view past about zoom
  15. Altitude is now opt-in through the field mapping editor.

## 0.3.0

Origin-destination flows and cross-filtering.

- **Flow layers.** A query with origin/destination columns renders an animated kepler flow layer —
  `lat0/lng0/lat1/lng1` coordinates or `sourceH3/targetH3` hexagons — with a selectable line style
  (straight, curved, animated). kepler does not auto-detect flow layers, so the panel builds and
  frames one from the query.
- **Cross-filtering, both ways.** A select/multi-select/text filter on the map writes its value to a
  mapped dashboard variable, and changing that variable applies the matching filter on the map.
  Configure the field↔variable pairs under **Cross-filtering**.
- **Fixed** the flow-layer shaders failing to compile (`DECKGL_FILTER_COLOR: no matching overloaded
  function`) by deduplicating deck.gl/luma.gl to a single ESM instance in webpack — the bundle was
  carrying both the ESM and CommonJS builds.

## 0.2.0

Time and trajectories.

- **Automatic trip layers.** A query with a trip id and a time is folded into an animated kepler Trip
  layer with a playback timeline — one path per trip, ordered by time. Optional altitude column.
- **Time range sync.** The dashboard time range drives the map's time filter (`toMap`, the default),
  optionally both ways (`bidirectional`), or not at all (`off`).

## 0.1.0

Data to the map.

- Any Grafana data source; each query becomes a kepler dataset, several to a panel.
- Column autodetection (lat/lng, time, trip id, geometry, H3, origin/destination), overridable per
  query under **Field mapping**.
- Geometry from GeoJSON, WKT or raw WKB/EWKB hex — a plain `SELECT geom` from PostGIS renders with no
  `ST_AsGeoJSON`, the plugin decodes WKB itself.
- Saved map configuration stored with the dashboard; configs pasted from kepler.gl, Foursquare Studio
  or Dekart accepted.
- Follows the dashboard theme, base map included (Carto, no Mapbox token; or a self-hosted
  `style.json`). No outbound calls to any vendor.
- Layer configuration survives a data refresh — data is swapped under the layers rather than the
  datasets being rebuilt.
- The heavy kepler.gl/deck.gl/MapLibre bundle is code-split, so a dashboard only pays for it when a
  map actually renders.
