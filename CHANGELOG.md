# Changelog

All notable changes to this plugin are documented here. Versions before 1.0 ship as GitHub
releases; 1.0 is the first Grafana catalog submission and is blocked on a stable kepler.gl 3.3.0.

## Unreleased

- Nothing yet.

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
