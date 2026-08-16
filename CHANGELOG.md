# Changelog

All notable changes to this plugin are documented here. Versions before 1.0 ship as GitHub
releases; 1.0 is the first Grafana catalog submission and is blocked on a stable kepler.gl 3.3.0.

## Unreleased

- **Fixed: "Save current map configuration" saved an empty config and wiped the layers it was
  meant to keep.** Clicking the button reverted the map to kepler's defaults and stored a config
  with no layers and no filters, so the user's edits were gone twice over — from the screen and
  from the dashboard. Three gears meshed to cause it. Grafana deep-clones the whole panel options
  object on every options change, so the click handed the load effect a JSON-identical copy of the
  saved config under a fresh identity; the effect answered with a "refresh", which since the
  `replaceDataInMap` fix is not a harmless no-op: kepler empties the store and restores it through
  async tasks. The save effect, running later in the same React commit, then snapshotted the map
  mid-swap — no layers, no filters, a stale `layerOrder` — and storing that snapshot triggered a
  second replace that overlapped the first one's restore and lost the configured layers for good.
  The decision now distinguishes doing nothing from refreshing: when neither the config (by value)
  nor the datasets (by identity) changed, the effect stays silent, so the snapshot always reads a
  settled store. Field mappings are re-anchored to their previous identity while their content is
  unchanged, closing the same options-clone hole for panels that have them. This also stops every
  click in the panel editor — any toggle, any slider — from putting the map through a full
  swap-and-restore cycle it never needed.

- **Fixed: a trajectory map went blank as soon as the dashboard time range drove it.** The plugin's
  two headline features cancelled each other out: a query with a trip id became an animated Trip
  layer, `Time range sync` then added kepler's time filter as documented, and deck.gl threw
  `TripsLayer … Cannot read properties of undefined (reading 'index')`, disabled the layer and left
  an empty map. The cause is upstream, in kepler.gl 3.3.0-alpha.3: its GPU filter reads a layer's
  values through an accessor it calls as `getData(dataContainer, feature, fieldIndex)`, but the Trip
  layer's table-mode accessor takes the feature _alone_, so the data container arrived where the
  feature was expected and had no `properties`. Only GPU-filterable filters — `range` and `timeRange`
  — reach that code, which is why a categorical cross-filter never triggered it and this looked like
  a time-sync problem rather than a filtering one. The panel now registers a Trip layer class whose
  accessor takes the arguments kepler actually passes, through kepler's own `layerClasses` registry.
  Traced by elimination and confirmed by experiment: same data and same filter, the layer's other
  column mode — whose accessor already has the right signature — renders cleanly. `tripLayerFix.ts`
  goes away when the pin moves to a kepler.gl that has fixed it.

- **Fixed: a shared link lost its cross-filter.** Opening a dashboard at `?var-category=parks`
  rewrote the URL to `var-category=$__all` within a few hundred milliseconds, so the filter a link
  was sharing was gone before anyone saw it. The first reconcile runs when kepler reports itself
  initialised, which is before any dataset has loaded — so there was no column to filter on,
  `applyFieldFilter` silently did nothing, and the sync recorded the field as agreed anyway. The next
  pass then read the map's missing filter as a deliberate clearing and published it back over the
  variable that was meant to be driving. Applying a filter now reports whether it landed, on the same
  contract `pushTimeRange` already used, and a field is recorded as synced only once the map has
  actually taken it; until then every pass keeps trying. The decision of which side drives moved into
  a pure function so the sequence is covered by tests rather than only by the browser.

- **A layer gallery dashboard.** `provisioning/dashboards/layers.json` draws every kepler.gl layer
  type the panel can build from query rows — thirteen of the nineteen kepler registers — on synthetic
  data, one map per type, each pinned to a single layer by a saved map configuration so nothing is
  left to autodetection. Beside every map is a table of the rows behind it, fed from the map panel
  itself through the `-- Dashboard --` data source rather than queried twice, and a `zona` filter
  wired both ways: narrow it in a map's own filter panel and every other map and table follows, or
  drive it from the dashboard variable. The six remaining types — `vectorTile`, `rasterTile`, `wms`,
  `tile3d`, `bitmap` and `3D` — are configured with a URL rather than with data, so no query can
  reach them. The rows are collapsed on purpose: each map holds two WebGL contexts and browsers cap
  them at around sixteen, so thirteen at once blanks the oldest — measured, not guessed.

- **Satellite base map, without a Mapbox account.** kepler ships five styles whose URLs are
  `mapbox://`, and picking any of them — the satellite one included — swaps MapLibre for mapbox-gl
  and requests `api.mapbox.com` with the empty token this plugin passes by design; the 401 comes back
  without CORS headers and the map goes black. **Satellite (Esri)** is a style the plugin serves
  itself, backed by Esri raster tiles: imagery, roads and place labels, the last two wired to
  kepler's own Road and Label switches so the image can be seen clean. Selectable from the panel
  options and from kepler's own base map picker. Under a hardened Grafana it needs
  `https://services.arcgisonline.com` in `connect-src`, and only if you use it — see the README.
  The five Mapbox styles are still listed and still blank the map; that is kepler's list, not ours.

- **Fixed: a re-run query never reached the map.** After the first load, every refresh — a dashboard
  variable, a time range, an auto-refresh interval — left the map showing the data it already had.
  The panel dispatched `updateVisData`, and for an id kepler already knows that takes the
  incremental-batch path meant for streaming a dataset in pieces: `KeplerTable.update` calls
  `this.dataContainer.update?.()`, and `RowDataContainer` — what a `{fields, rows}` dataset gets —
  has no `update` at all, so the optional chaining swallowed the call in silence. Existing datasets
  now go through `replaceDataInMap`, which is kepler's own answer and keeps the layers, filters and
  layer order pointed at the new data; only a genuinely new dataset takes the `updateVisData` path.
  Traced end to end in the browser: the variable changed, the query re-ran with the new value, the
  database returned a complete wind reversal — 4.3 m/s from 250° against 2.9 m/s from 70° — and the
  map moved not one row. It now follows, with the layer intact.

- **Animated wind and current fields.** A query returning a regular grid of velocities — `speed` +
  meteorological `direction`, or `u`/`v` components including GRIB2's `ugrd`/`vgrd` — becomes a field
  of streamlines with no layer setup. The grid is inferred from the rows in any order, smoothed, and
  traced into paths that kepler's own Trip layer animates: no custom layer, no shaders. The tracing
  is adapted from [Esri's `animated-flow-ts`](https://github.com/Esri/animated-flow-ts) (Apache-2.0).
  A `trip_id` column disqualifies the query, so a GPS trace carrying a `speed` column is still drawn
  as a trajectory. Cells the query omits are holes rather than calm air, which is what lets a level
  running below ground be excluded by leaving it out: the lines stop at the mountains instead of
  drawing weather over rock. Several velocity queries in one panel share one budget of lines per
  screen, and stack in the vertical when an **Altitude** column is mapped.
- **Streamlines follow the view.** Traced once in geographic space they thin out on zooming in and
  mat together on zooming out, so the field is re-traced whenever the map settles — a fixed number of
  lines per screen, each a fixed number of pixels long, seeded only where there is data. Replacing
  the rows uses `replaceDataInMap` rather than `updateVisData`: for a dataset id kepler already
  knows, `updateVisData` takes an incremental-batch path and the row count never changes, which is
  why the map appeared not to react to zoom at all. Verified against the store rather than the
  panel's row-count label. Playback survives the swap: `updateAnimationDomain` clears `isAnimating`
  while the layers are momentarily gone, so the playhead and the running state are captured before
  the replacement and restored after it — otherwise every pan silently stopped the animation.

- **Wind line density is a panel option.** The budget of streamlines per screen was a constant, and
  no constant fits: a country covering a third of the view wants more lines than a pair of
  three-kilometre patches around two weather stations, and a field of parallel arrows mats into a
  solid block at a density a swirling one reads well at. Layers still share whatever the option is
  set to, rather than each spending it in full.

- **The time slider can cross-filter without eating its own data.** A new **Slider writes variables**
  choice under _Time range sync_ publishes the slider's window to two dashboard variables — UTC ISO
  8601, so `WHERE t >= '$mapFrom'::timestamptz` needs no arithmetic — instead of moving the dashboard
  time range. This is the mode to use for cross-filtering: moving the range re-runs _this_ panel's
  query too, and the rows outside the new window then leave the browser, so the histogram behind the
  slider rescales under the cursor and the window can never be widened again from the map. Writing
  variables costs only the panels that reference them, and the map's own query stays on
  `$__timeFilter`, so the dataset stays whole and the slider keeps showing all of it with the brush
  as a mask over it — how kepler's time widget is meant to behave. The map's filter is seeded with
  the data's own extent rather than the dashboard range, so the widget opens on the full histogram
  with nothing yet narrowed. Both directions work: setting either variable moves the brush, so a
  shared dashboard link restores the window. Writes are debounced, and suppressed entirely while the
  slider is playing, so a drag or an animation is one dashboard update rather than one per frame.

- **Bidirectional time sync no longer re-queries the dashboard on every frame of a drag.** kepler
  updates the time filter on each pointer move, and each of those was a new dashboard range and so a
  new round of queries on every panel. The window now reaches the dashboard once the slider comes to
  rest, and playing the slider is sat out entirely — an animation reports where it stopped rather
  than each frame it passed through. Debouncing exposed a second problem it also fixes: for as long
  as a reported window is in flight, the dashboard range still reads what it did before, and pushing
  that back at the map snapped the brush out from under the drag. That stale value is now ignored
  until it moves — which is either the report landing or the user reaching for the time picker, and
  neither is swallowed.

- **Sync hooks no longer wake on every kepler action.** All four subscribe to the map's store, which
  fires for anything kepler dispatches — panning the map is a stream of them — and each notification
  cost a scheduled reconcile, for the variable syncs including a fresh parse of the URL. They now
  compare the identity of the three vis-state slices they actually read (filters, datasets, the
  animation config) and skip everything else, at the cost of three reference comparisons.

- **Fixed** bidirectional time sync dragging the dashboard time picker down to the data's extent on
  load, unasked. The echo guard held one value and recorded the range it _asked_ kepler for, but
  kepler clamps a window to the data's own domain — so with a dashboard window wider than the data,
  which is the ordinary case, the clamped window came back looking like the user had dragged the
  slider and was reported to Grafana, costing a second round of queries on every panel. What was
  pushed and what kepler kept are now tracked separately. The guard also watches the data's time
  domain, which stops the other half of the loop: once the dashboard range follows the map, the
  narrower range re-runs the query and kepler re-clamps the window to the data that is left — a move
  no user made, and previously reported as though one had.

- **Maps on a dashboard can share a clock.** The new **Sync time with other maps** switch under _Map_
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
- **Trip layer shape is selectable.** The new **Trip layer** option under _Map_ chooses between
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
  through Cuenca at 2,650 m was drawn 2.65 km up and fell out of the camera's view past about zoom 15. Altitude is now opt-in through the field mapping editor.

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
