# Changelog

All notable changes to this plugin are documented here. Versions before 1.0 ship as GitHub
releases; 1.0 is the first Grafana catalog submission and is blocked on a stable kepler.gl 3.3.0.

## Unreleased

- **Changed: a velocity grid is now a kepler layer type, configured on the map rather than in the
  panel options.** Until now a wind query was traced by the data path — the panel built the field,
  traced nine thousand streamlines and handed kepler their geometry as rows of a `_geojson` column,
  which it drew as an ordinary Trip layer. Nothing said "velocity field" anywhere in the interface,
  the density was a panel option, and everything else about the drawing was a constant in the
  source: a sixty-second cycle, a lifetime of 0.55 of it, thirty vertices, three cells of smoothing.
  There is now a **Flow field** layer with a panel of its own: lines per screen, stroke width, trail
  length, line length, cycle, lifetime, smoothing and vertical exaggeration, next to a colour ramp
  applied to each line's mean speed. The dataset now holds the lattice the query returned rather
  than the lines drawn from it — forty-nine rows instead of nine thousand, in the tutorial's case —
  and the four velocity columns can be re-pointed from the layer, which is what finally gives
  `u`/`v`/`speed`/`direction` a place in the interface: they were autodetect-only before, because
  they never reached kepler as columns at all. Panning is cheaper too: what travels on a re-trace is
  a viewport, not a dataset, so playback is no longer stopped and the playhead no longer restored on
  every drag. **`windDensity` is gone** — a dashboard that set it keeps working, and the layer opens
  at the same 9,000. Three things about kepler this rests on, each of which cost an afternoon: layer
  data is recomputed on *every frame* of the animation for any animatable layer whose type is not
  `trip`, so the trace is kept behind a signature; `layerVisConfigChange` never republishes the
  animation domain, so the clock has to be nudged, without which the time widget never appears at
  all; and both `centerMap` and the viewport guard frame the map from layer bounds, which the Point
  layer used to carry and this layer supersedes.
- **Fixed: a map that took more than six seconds to load could silently return to San Francisco.**
  kepler seeds its internal view state with its own default at mount and writes it back on a
  debounce, so a slow load lands that echo *after* the panel has framed the map on the data. The
  guard that exists for exactly this watched a six-second window; the echo was measured arriving at
  seven. The window is now fifteen seconds, and it is re-armed whenever the panel adds a layer that
  moved the viewport. Invisible on most maps — the base map is simply somewhere else — but a flow
  field draws its lines in proportion to the share of the screen its data covers, so a field left
  off-screen drew nothing at all, with nothing logged.

- **Added: a query can draw a Zarr store, live, and the map's clock can walk its slices.** Return
  `zarr_url` and `zarr_variable` and the panel builds a tileset from a store published as-is on
  object storage — no download, no conversion, no ETL. The premise this started from turned out to
  be backwards: DuckDB's `raster` extension carries GDAL's Zarr driver but **not blosc**, which is
  what xarray writes by default, so the three public stores tried all failed at decompression. The
  server that could already do it was the one in the compose file — `titiler:2.2.1` ships
  `titiler-xarray` and mounts a `/zarr` router — so this needed no new service and no change to the
  deployment at all. Handing the store to a server rather than to the browser also settles CORS,
  which many public stores send none of: the one fetching chunks is the server. The moment travels
  as the store's **own index label**, because TiTiler passes it to xarray's `.sel`, which matches
  literally and has no nearest-neighbour fallback — a store stamped at 09:00 answers `500` to the
  date-only spelling of its own dates, so `zarr_time_label` is a role of its own and the panel only
  guesses when the query says nothing. Moving the timeline rewrites one URL parameter: no dataset is
  rebuilt and no query re-run. Set **Zarr value range** — a scientific store holds physical units
  and nothing in it says which slice deserves a colour; left empty each tile stretches over its own
  extremes and the map reads as patchwork. Two things worth knowing before pointing this at a large
  store: a Zarr has no overviews unless it was written with them, and chunks spanning the whole time
  axis mean one day pulls every day in the block — measured on GPCP, tiles came back in 1.2 s to
  17.5 s apiece, so a cache in front of the tile server earns its keep. Which brings the next point.
- **Added: a pyramided Zarr is drawn at the zoom's own level, which is four to ten times quicker.**
  Say how deep the store's `multiscales` pyramid is with `zarr_levels` and every zoom asks for its
  own level instead of reading native resolution and resampling. Measured against the same server:
  CarbonPlan's pyramided demo answers in 0.22–2.2 s and stays **flat across zoom**, where GPCP
  without a pyramid takes 2.1–9.0 s and gets worse the further you zoom out. Writing the same data
  locally both ways settles what the cost really is — a well-chunked Zarr read in 0.06 s against a
  COG's 0.023 s, the same data in one big chunk 0.16 s — so this is the store's layout talking, not
  the format's ceiling. The panel has to pick the level because the server will not: `titiler.xarray`
  does not read the `multiscales` convention at all. It does take a `group` parameter, and a pyramid
  written by ndpyramid names its groups by zoom, so the tile template carries `group={z}` and deck
  substitutes it — which works only because deck's substitution is a global replace, and only if the
  braces are kept out of the URL encoder. Declaring the depth also caps the request: past the
  deepest level deck reuses what it holds instead of asking for a group the store does not have and
  collecting a `500` on every tile. And `zarr_sel` pins the other non-spatial axes — a store may
  have a band *and* a month, and each travels as its own `sel`. And `zarr_time_dim` lets the clock
  walk an axis that is neither called `time` nor spelled as dates — CarbonPlan's demo holds twelve
  months as `month=1..12`, integers, and the map's timeline walks them by mapping each moment of the
  clock to the label the store knows. Naming an axis switches off the timestamp fallback on purpose:
  a store holding months answers to `7` and never to a datetime, so guessing there would be a `500`
  on every tile.
- **Added: a Zarr can be measured, not only drawn — over a polygon you draw on the map.** The
  `/zarr` router mirrors `/cog` route for route (`statistics`, `point`, `feature`) and takes
  `variable`, `sel` and `group` alongside, so the number beside the map is about the slice on the
  map rather than some default the server picked. No plugin code was needed: the panel already
  publishes a drawn figure to a dashboard variable. What the documentation now carries is the four
  things that each cost an iteration to find. The figure travels as **WKT** and TiTiler wants
  **GeoJSON**, so a query variable converts it — and inside a *variable* query this data source does
  **not** add the quotes it adds inside a panel query, which surfaces as a parser error pointing at
  a comma rather than at the variable; `ST_AsGeoJSON` also needs an explicit `::VARCHAR` or the
  scan fails on a Go type name. The numbers only follow the clock under **Slider writes variables**,
  because that is the only mode where the window is published at all — under any other, a statistic
  quietly reports the newest slice however you move the slider. And panels sharing one request
  through the `-- Dashboard --` data source turn three identical POSTs into one, after which another
  number costs nothing. The store's layout decides the cost here as much as it does for drawing: the
  same polygon takes 1.0–1.5 s on a pyramided store and 6.9–21.1 s on one chunked 200 days deep.
  Note that the DuckDB route documented for a COG does **not** transfer — its GDAL has the Zarr
  driver but not blosc, so for a Zarr the tile server is the only one of the three that works.

- **Added: a query can draw a WMS, and the map's clock can walk its dates.** Return `wms_url` and
  `wms_layer` and the panel builds the layer — no tile server anywhere, which is what makes this
  work on a Grafana with nothing behind it. kepler 3.3.0-alpha.7 draws a WMS but has no notion of
  its time dimension, so a time-aware service answered with its default slice for ever; the date now
  reaches the request, and moving the time widget re-asks the service for one image without re-running
  the query or rebuilding the dataset. Where the dates come from is a choice the query makes by
  saying nothing: with a time column those rows are the timeline, without one the panel reads the
  layer's `<Dimension name="time">` from the service's own `GetCapabilities` — the version that
  stays correct as a server gains new passes. Note for strict-CSP installs: a WMS image is fetched
  and parsed as data, so the host belongs in `connect-src` and **not** `img-src`, and the symptom of
  getting that wrong is a map that draws nothing without a word about images. Clicking a queryable
  layer asks the service what is under the pixel, on the date being shown, and a click mapping on
  `wms_value` puts that number in a dashboard variable. And where the same GeoServer publishes a WCS
  over the coverage, the imagery on screen can be *read* rather than only drawn: the provisioned
  dashboard cuts it to the polygon you draw on the map and reports the zonal mean, in one query,
  with no ETL and no second source.

- **Added: a query can draw a satellite scene.** Return a column named `raster_url` — or `cog_url`,
  `cog`, `asset_href`, `href` — and the panel builds a raster dataset from it and lets kepler draw
  it with the `RasterTileLayer` that 3.3.0-alpha.7 already registers but has no server for. What was
  missing was a tile server and the path from a query to the layer, and both are now here: the
  **Raster tile server** panel option names a TiTiler-compatible service, which reads the imagery on
  the map's behalf — so it, not the browser, is what has to be able to reach the file, and a private
  raster therefore needs a server of your own. The option defaults to `https://titiler.xyz`, which
  is what kepler itself falls back to for a lone COG: enough to draw a public scene out of the box,
  and no use for anything private, since it is handed the URL signature and all. A catalogue query
  makes the imagery follow the dashboard — parameterise a STAC search by `$__timeFrom()` and
  `$__timeTo()` and the scene changes with the range, without moving the frame or restyling the
  layer; a range with no scene under the cloud threshold returns no rows and the raster leaves the
  map with them, because showing the previous one would be showing imagery from outside the range.
  Two notes for anyone debugging this: the tiles arrive over XHR, so a strict CSP wants the tile
  server's host in `connect-src` and **not** `img-src`, and kepler swallows a STAC document it
  rejects — the symptom is an empty layer and no error at all, checkable by reading
  `metadata.stac_version` on the dataset. The 71 colormap PNGs kepler loads from Foursquare's CDN
  are now vendored with the plugin, because the panel repoints kepler's `cdnUrl` at itself and the
  colormap is fetched in the same `Promise.all` as the tile: a 404 there took down **the whole
  tile**, not just its colours.

- **Added: the map's clock walks a series of scenes.** Return one row per date and the query stops
  being an answer and becomes a small catalogue: the time widget shows a bar per capture and draws
  the most recent scene *inside* the window — not the nearest one, because an image captured after
  the moment you dragged to was not on the ground then. Dragging costs no query at all, since the
  series is already in the browser. The scene changes **on the layer that is already drawing**
  rather than by replacing the dataset, which is what keeps the layer's id, its name and everything
  you styled through a date change, and deck.gl keeps the previous image on screen while the new
  tiles refine — measured across eight captures during a change, with no bare frame among them. A
  window containing no scene **hides** the layer instead of dropping it: playback crosses gaps on
  every loop, and rebuilding on the far side handed back a layer with default styling each time,
  which reads as styling that resets itself. Note for anyone tempted by the obvious alternative:
  coupling this through dashboard variables does not work. The imagery query would read variables
  the panel itself publishes, so moving the window re-runs every query on the panel including the
  one feeding the filter, which resets and republishes. The loop was measured, not theorised.

- **Added: PMTiles — the same imagery with no server at all.** A URL containing `.pmtiles` takes a
  different path entirely: kepler reads the archive itself over range requests, and the tile server
  option is ignored. That is the answer for an install with nowhere to run a service — all the file
  needs is somewhere static with CORS and byte ranges. It is decided by the data rather than by
  configuration, so both kinds can sit on one dashboard and a COG with no server is discarded
  without taking the archive beside it down. The cost is one thing: an archive holds **pictures**,
  so the colours were baked when it was built and kepler's layer panel offers opacity and nothing
  else. Sixty days of CHIRPS rainfall came to 26.4 MB against ~37 MB of COG, with zero requests to
  any server while drawing and animating. Scene changes take a rebuild here rather than a
  re-pointing, because kepler's archive path gives deck.gl no way to learn its tiles have expired —
  a failure with a good disguise, since the network shows requests against the new file that are
  its header and directory and never a tile.

- **Added: a colour ramp for rasters a query produces.** kepler's default is `cfastie`, which was
  built for drone NDVI and is not monotonic — it steps through black, grey, white, green, yellow,
  red and magenta, so on a continuous field like rainfall neighbouring cells of similar value land
  on unrelated colours and the map reads as confetti. The **Raster colour ramp** option imposes one
  of eight ramps instead, and left empty imposes nothing. Related, from drawing rainfall: a
  continuous field should be painted over its whole extent with the dry end at the palest tone,
  because a field drawn only where there is something reads as noise.

- **Added: the raster can be measured, not only drawn.** Three ways, all of which produce a table,
  which is what a Grafana panel eats — and none of which vectorises pixels in order to draw them.
  A TiTiler-compatible server answers `/cog/statistics` for a whole scene or, with a GeoJSON in the
  body, for one polygon, and `/cog/point/{lon},{lat}` for a single coordinate; the Infinity data
  source calls those directly, and since the panel already publishes the clicked coordinate and any
  polygon you draw, clicking the map moves the number. Inside DuckDB, the `raster` community
  extension does what the tile server cannot: `RT_CubeClip` plus `RT_CubeStats_Agg` with a
  `GROUP BY` joins imagery to your own tables, so four thousand zones is one query rather than four
  thousand HTTP requests. And `COPY … FORMAT RASTER` writes a COG, so an index computed in SQL is
  drawn through the same path as a Sentinel scene. The finding that costs the most time if you meet
  it blind: **kepler cannot draw a float32 raster** — it has no maximum value to rescale a float
  against and gives up, requesting no tiles and reporting nothing. `uint8` draws flat; `uint16` is
  what works.

- **Changed: the panel is now "Kepler Geospatial Maps".** "Maps by Kepler.gl" put the plugin's
  identity in the authorship slot: the catalog card credits UBICA while the name reads as if the
  kepler.gl project had published it, and Grafana's plugin policy asks that you hold the rights to
  any trademark you ship. The new name also matches how Grafana searches. The visualisation picker
  matches the plugin `name` as a plain substring and reads neither the id, nor the description, nor
  the keywords, so every word someone might type has to live in the name itself — map, geo, spatial,
  kepler — and no other panel in the catalog claims "geospatial". The id stays
  `ubica-keplergl-panel`: it is frozen at publication and has to match the grafana.com organisation
  slug. Keywords pruned from 18 to 13, since `spatial`, `temporal` and `spatio-temporal` were one
  term spelled three ways and `panel` only repeats the plugin type, and `info.links` now carries the
  documentation and source-code URLs.

- **Fixed: the growing-window animation now reaches the last of the data before looping.** With the
  playback set to an incremental window — the start anchored, the end advancing — kepler discarded
  the final step instead of clamping it: the moment one more increment would pass the end of the
  domain, the window jumped back to the anchor. Measured on the provisioned rainfall calendar of
  2026-08-20…26, the window end climbed to 2026-08-25T23:58:38 and restarted, a minute and a half
  short, so the last day's image was never drawn and its histogram bar never lit up. Clamping to the
  last timestamp is not enough on its own, because a time filter's domain *ends* on the newest row:
  a window stopping there would reach the final scene for one animation frame, too briefly to fetch
  the image, let alone see it. So the sweep now runs to the end of the last histogram bin — the span
  the slider already draws, since it pads its display range by one bin so the edge bars are not
  clipped — and the last scene gets the same turn as every other. The visible consequence is that
  the end of the window travels one bin past the newest timestamp on its way out, which is what
  kepler's sliding-window mode has always done. Free, point and interval playback are unchanged.

- **Fixed: the time slider is drawn on top of its histogram, not under it.** kepler renders the
  brush — the shaded window and the two drag handles — as a child of the plot, and its unmasked
  histogram puts that group *before* the bars. SVG has no z-index, so siblings paint in document
  order and every bar covered the handles: on a dense demo histogram they fall in the gaps and the
  flaw goes unseen, but on a daily series, where a handful of bars fill the width, each handle sat
  half-buried and the selected window disappeared entirely. The bars carry `pointer-events: none`,
  so dragging never stopped working — the slider was invisible, not inert, which is why it read as a
  styling bug. The defect is upstream and unfixed on kepler's master, and no stylesheet can answer
  it, so the panel lifts the group to the end of the enclosing `<svg>` after each commit, which is
  where kepler's own masked histogram already puts it.

- **Fixed: the cross-filtering hooks no longer re-subscribe to the map on every render.** The
  mappings reached the map as `options.variableMappings ?? []`, and all four sync hooks — filter,
  click, coordinate and centre — key their store subscription on that value. Grafana's clone moved
  its identity on every options change, and the `?? []` fallback moved it on every render when no
  mapping was configured, so each render tore down four subscriptions and made four more. Anchored
  with the same `useStableValue` the field mappings and viewport variables already use. Measured in
  the browser: three variable changes now add zero subscriptions.

- **Added: two base maps with real elevation, and the base maps that need an account are gone.**
  "Satellite + relief" and "Topographic + relief" carry a `terrain` key that MapLibre reads straight
  from the style document — kepler has no notion of terrain, but it passes the key through, which is
  what makes elevation possible at all — with Esri imagery or topographic cartography over
  Mapterhorn's elevation tiles. Tilt the camera and the ground rises. Two limits worth knowing: the
  relief belongs to the *base map*, so deck.gl keeps drawing your data at its own altitude rather
  than draping it over the terrain, and kepler pins MapLibre 4, where panning a tilted terrain map
  can jitter the camera (keplergl/kepler.gl#3394).

  The panel now replaces kepler's list of base maps rather than adding to it. Five of kepler's nine
  defaults are `mapbox://` styles that blank the map when clicked without an account; they are no
  longer offered. The three that work without one — Carto's — are re-registered from kepler's own
  definitions, as is "No Basemap", which would otherwise have gone with them.

  Two fixes fell out of building it. The style picker showed broken thumbnails for every Carto
  entry: kepler names its thumbnails as paths under the app's `cdnUrl`, which this plugin points at
  its own assets, so each one asked the plugin for a `geodude/*.png` it has never shipped. They are
  now real tiles from the service each style draws, like the satellite entry already used. And the
  panel's own Esri attribution is gone: as of kepler 3.3.0-alpha.7 the attribution bar reads each
  source's `attribution` field, so rendering the credit ourselves showed it twice.

- **Changed: the map credits kepler.gl, and the plugin has a mark of its own.** The side panel used
  to read "Grafana", because the panel passed its own `appName`; it now shows kepler's default,
  "kepler.gl", with the version underneath — the header names the library the map comes from, and
  claiming it for the host was wrong. The icon went the other way. It started as kepler's own mark,
  the two overlapping squares rebuilt from the geometry the library draws inline, but that mark
  identifies kepler.gl and is not ours to ship as the identity of a third-party plugin. It is now
  three hexagonal cells extruded to different heights over an isometric grid, in Grafana's orange
  ramp: the 3D hexbin layer kepler.gl is known for, read at the same time as a bar chart. Two
  variants ship — `img/logo-large.svg` with the base grid for the catalog page, `img/logo-small.svg`
  tight-cropped for the panel-type picker, where the grid turns to noise below 24 px. The source
  set, monochrome variants included, lives in `brand/`.

- **Changed: catalog readiness — the plugin now passes Grafana's full plugin-validator.** Running
  it against a packaged build (not just the `metadatavalid` analyzer CI already ran) surfaced three
  fixable things: the Apache licence still carried its `{yyyy}` / `{name of copyright owner}`
  placeholders, `plugin.json` declared no screenshots — the catalog shows them on the plugin page —
  and the CI only ever checked metadata. The licence is filled in, two screenshots taken from the
  running plugin are shipped (global seismicity over remote GeoParquet, and origin-destination
  flows), and CI gained an advisory full-validator step alongside the blocking metadata one; it is
  allowed to fail because the validator also reports states that are only true until publication.
  Two warnings remain by design: "unsigned plugin", expected until the catalog review signs it, and
  the `ubica` account prefix, which needs the Grafana Cloud account to exist. The e2e job also now
  starts only the `grafana` service rather than the whole compose file — it was booting the
  strict-CSP instance and the data-sources bench too, three Grafanas competing for a two-core
  runner.

- **Changed: kepler.gl 3.3.0-alpha.7.** A clean bump — no source change was needed, and the
  transitive deck.gl (9.3.10) and luma.gl (9.3.6) versions are unchanged, which is the axis that
  matters here: the flow layer's shaders need a single deduped instance of both. Upstream adds
  filter-feature badges on the map, an optional theme toggle driven by `uiState.theme` (off unless
  an app config enables it, so the panel's own theme still wins), column statistics, sketch draw
  modes behind a config flag, and `padding` on `fitBounds`. The internals this plugin leans on are
  untouched — `map-view-state-context.js` is byte-identical, so the load-window viewport guard is
  still both necessary and correct. Verified: unit suite, the full 26-spec e2e suite, and the
  browser on both dev containers including the strict-CSP one, with no new console errors.

- **Added: the map can publish its viewport as a bounding box, for other panels to filter by.**
  "Publish viewport (for other panels)" names four dashboard variables and the map writes the
  edges of what it is showing into them, so a consuming panel answers "filter to what I am looking
  at" with `WHERE lng BETWEEN $west AND $east AND lat BETWEEN $south AND $north`. Numbers rather
  than WKT: they carry no injection risk into a consumer's SQL. Published once on load — a
  consumer should not open without bounds — and thereafter when the map comes to rest, 300 ms
  after the last pan or zoom, so one gesture costs one round of queries rather than one per frame.
  Edges are clamped to coordinates that exist, since a world-wide view computes a span past the
  antimeridian and the poles, and an unchanged view writes nothing. The option's name carries its
  own warning, and so does the editor hint: this is for the *other* panels. Filtering the map's
  own query by its own viewport is a ratchet — the data shrinks to what is on screen and zooming
  out cannot bring those rows back. This completes the cross-filtering design's five escalones.

- **Tested: the cross-filtering channels have end-to-end regressions, and the suite is green
  again.** Five new specs cover what only browser sessions had verified: the coordinate channel
  (a click publishes the pair, the unpin toggle and a data refresh both keep it), the entity click
  (publish, deselect, and a shared link's preset surviving stray clicks), a preset min/max pair
  filtering the map on load, the centre mapping (an outside write moves the viewport, the map's
  own click never does) and the viewport guard's data-fit path. Three long-standing failures were
  the specs, not the plugin — they still described the pre-`table` trip mode (80 rows rather than
  2, a lone trip layer rather than trip + point, one saved layer rather than two) — and are now
  fixed. Local Playwright workers drop from four to two: the suite grew by half, and at four the
  remaining failures were pure contention between software-rendered maps, a different trio every
  run and each passing alone. The whole suite now passes deterministically.

- **Fixed: the map no longer opens on kepler's default San Francisco instead of its own
  viewport.** kepler 3.x localises the view state in a React context seeded at mount time — the
  default — and a debounced write-back pushes it into Redux after deck's first emissions. On load
  that echo raced the saved config's `addDataToMap`, and whichever landed last won: sometimes the
  saved viewport, sometimes the default, which is why the bug came and went. A load-window guard
  now defends the intended viewport for a few seconds after each rebuild: whenever the map lands
  exactly on kepler's initial triple it puts back the saved viewport — or re-fits the data bounds
  on a config-less map, whose centre-on-data the same echo undid. Bounded by a window and an
  attempt cap, and keyed to the exact default fingerprint, so it can never fight a user's real
  panning. Verified with an action-level timeline: the echo still fires, and the guard corrects it
  within ~50 ms, once per load.

- **Added: the map can be centred from outside through its lat/lng variable pair.** A
  cross-filtering mapping row switched to "Center" reads the pair back into the viewport: when the
  variables change from outside the map — a table row's data link, a textbox — the map centres on
  them, jumping to the row's optional Zoom level (empty keeps the current zoom). Two silences make
  it liveable: the map's own clicks — which the Coordinates mapping writes into the same pair —
  are recognised against the pinned coordinate and never re-centre, and a pair that has not moved
  is never re-asserted, so unrelated variable changes cannot yank the map back from a pan. On load
  the saved viewport wins — the first pass adopts the pair without acting, because centring raced
  the saved-config restore and whichever dispatch landed last won. The earthquakes dashboard wires
  it up: the strongest-quakes table carries hidden lat/lng columns and a per-row data link, so
  clicking a quake centres the map on it at zoom 6 while the coverage circle and heatmap recompute
  around it. Covered by unit tests over the pure decision module (`centerSync.ts`) and verified in
  the browser: table-click centring, echo-free map clicks, and a load that stays put.

- **Added: the earthquakes sources dashboard demonstrates the coordinates mapping end-to-end.**
  Clicking the map publishes the place to `$lat`/`$lng`; DuckDB builds a geodesic circle of
  `$radio` km around it — the spherical destination formula per bearing, because `ST_Buffer` is
  planar and in degrees — and intersects the month's quakes with that same ring. Both come back as
  ordinary queries: the coverage outline as `ST_AsHEXWKB` into a pinned geojson layer, the
  intersected quakes as a magnitude-weighted heatmap. `$lat`/`$lng` default to coastal Ecuador so
  the circle exists from the first render — a dataset that is empty at load has no fields for the
  saved config's layers to bind to, and kepler drops them.

- **Added: clicking the map can publish the clicked coordinate to a lat/lng variable pair.** A
  cross-filtering mapping row switched to "Coordinates" names two variables, Lat and Lng; any click
  on the map pins the place clicked and the pair takes it (escalón 3b of the cross-filtering design
  doc). The variables are for the other panels' spatial queries — `ST_DWithin(geom,
  ST_MakePoint($lng, $lat)::geography, $radius)` with `$radius` a plain dashboard variable — and
  the computed coverage returns to the map as an ordinary query, so the panel carries no spatial
  logic at all. The panel switches kepler's coordinate interaction on by itself, and back on after
  a saved-config restore. kepler's pin toggles — a second click unpins — but the variables keep the
  last spot until the next pin, so a coverage query never loses its centre; a data refresh keeps
  both the pin and the variables, and clicks made while the draw toolbar is engaged publish
  nothing. An entity click also pins, deliberately: clicking a vehicle both selects it (a Click
  mapping) and recentres a coverage query there. The sample cross-filter dashboard gained a
  `$lat`/`$lng` pair driven by a Coordinates mapping. Covered by unit tests over the pure decision
  module (`coordinateSync.ts`) and verified in the browser on both containers: publish on click,
  quiet unpin, refresh survival, draw-toolbar silence, and co-publishing with the entity click.

- **Added: clicking an entity on the map can publish it to a dashboard variable.** A
  cross-filtering mapping row can now be switched from "Filter" to "Click": the value of its
  column for the clicked point or trajectory lands in the variable — `WHERE vehicle_id =
  '$vehicle'` on any consuming panel — so clicking a vehicle filters the rest of the dashboard to
  it (escalón 3 of the cross-filtering design doc). One direction only, map → variable; a filter
  mapping on the same column remains the way to drive the map from the variable. Clicking empty
  map — kepler's deselect gesture — publishes the variable blank, but only when the running
  selection was published by this panel: a dashboard opened from a shared link keeps its preset
  value through any number of stray background clicks. A data refresh resets kepler's click state
  without a gesture (`replaceDataInMap` removes and re-merges the layers), which the sync reads
  as "no state", never as a deselect — the selection survives auto-refresh. Resolution rides
  kepler's own tooltip path (`layer.getHoverData`), so it is uniform across layer types,
  including both Trip layer shapes: a `geojson`-mode trip resolves to its trajectory's row and a
  `table`-mode trip to the vertex under the playhead, falling back to the trip's first vertex
  when the playhead sits outside its window (a fading trail is still clickable). The sample
  cross-filter dashboard gained a `site` column and a click mapping publishing it to `$site`.
  Covered by unit tests over the pure decision module (`clickSync.ts`) and verified in the
  browser: publish on click, entity switch, blank on deselect, refresh survival, shared-link
  protection, and both trip modes.

- **Added: a numeric range filter can be published as a min/max variable pair.** A cross-filtering
  mapping now takes an optional second variable ("Max"), turning it into a range mapping: narrow a
  filter on a numeric column and the pair lands in the two variables —
  `value BETWEEN '$valueMin' AND '$valueMax'` on any consuming panel — the same two-variable
  encoding the time window already uses. Both directions work: presetting the pair in a shared
  link (or typing bounds into the text boxes) creates or moves the filter on the map, and deleting
  the filter publishes both variables blank so they can drive again. Publishing is debounced with
  the same 300 ms rest as the time variables, because a histogram brush updates the filter per
  pointer move — one write per gesture, not one per frame. Scalar mappings are untouched;
  `range` stays out of their filter set and rides its own path (escalón 1 of the cross-filtering
  design doc). The sample cross-filter dashboard gained the `valueMin`/`valueMax` pair and a
  panel that renders what was published. Covered by unit tests over the pure sync helpers and
  verified in the browser across the full cycle: create-from-variables, publish-on-edit,
  blank-on-delete, recreate-from-variables.

- **kepler.gl 3.3.0-alpha.6.** The pin moves up three pre-releases from alpha.3. The `@kepler.gl/*`
  packages now publish dual CJS/ESM builds behind an `exports` map, so the two deep imports the
  portal fix relies on drop their `/dist` segment, and the effect panel's new date/time picker
  dependencies (`react-date-picker` and friends, ESM-only) join jest's transform allowlist. The
  Trip layer's GPU-filter accessor is still broken upstream — `tripLayerFix.ts` stays until a
  kepler.gl release fixes it. Verified end to end: typecheck, the unit suite, the production
  build, and the e2e specs covering every piece of version-sensitive webpack machinery — portal
  placement, the effects panel, polygon drawing, flow-layer shaders — all pass.

- **Fixed: side-panel dropdowns opened far below their trigger, often invisible.** Changing a
  layer's type — or opening any of kepler's selectors, field pickers and color palettes — showed
  the options well below where they should be, and near the bottom of a panel not at all. kepler's
  `Portaled` component parents every popover to KeplerGl's root div and positions it
  `position: fixed` at viewport coordinates; inside a Grafana dashboard that root sits under
  `.react-grid-item`, whose CSS transform makes the panel — not the viewport — the containing
  block for fixed descendants, shifting every popover down by the panel's own offset, and the
  panel chrome clipped whatever poked past the edge. `Portaled` is not an injectable factory, so
  webpack now rewrites every kepler-internal request for the module to a thin wrapper that severs
  the RootContext, making the portal fall back to `document.body` — no transformed ancestors, no
  clipping, and kepler's coordinates land where they were computed. Dropdowns now open next to
  their trigger and may extend past the panel like any ordinary dropdown. Covered by e2e tests
  that open the layer-type dropdown on a dashboard and actually pick an option from it.

- **Added: the drawn polygon or rectangle can be published to a dashboard variable, as WKT.** The
  figure drawn with kepler's draw tool was locked inside the panel; now **Cross-filtering → Publish
  drawn area** names a text box variable and the figure lands in it as canonical WKT (EPSG:4326) the
  moment it is finished — `WHERE $area != '' AND ST_Intersects(geom, ST_GeomFromText($area, 4326))`
  in any other panel, against PostGIS, MobilityDB or DuckDB `spatial`. The shape of the channel
  follows the cross-filtering design doc. Only the most recent figure is published — kepler keeps
  figures in two places (a finished polygon waits in the editor until a layer is chosen, a rectangle
  becomes a polygon filter immediately), and the sync reads both. It publishes on the gesture, with
  the same 300 ms rest the time variables use, because dragging a vertex updates the store per
  pointer move. It never writes on dashboard load — the first pass adopts whatever figures a saved
  config restored, silently — so a shared link keeps the value it was opened with. And it is
  one-way by design: the variable exists for the _other_ panels' queries, and feeding it back into
  this panel's own would shrink the map's dataset under the drawn shape, which could then never be
  widened again. Deleting the last figure clears the variable to `''`, which keeps the SQL guard
  literal. The WKT is emitted by the plugin — fixed format, coordinates rounded to 6 decimals — so
  the variable never carries text the plugin did not format, and a hand-drawn shape does not bloat
  the URL with float noise. Along the way: the field-mapping sync now skips polygon filters, whose
  `name` is layer labels rather than a column — a layer labelled like a mapped column would have fed
  a GeoJSON Feature into the variable as that column's value.

- **Fixed: drawing a polygon or rectangle filter did nothing.** The polygon collected its vertices
  and then refused to close — double-click, Enter and clicking the first vertex all died in
  `finishDrawing` — and the rectangle broke one step earlier, on its very first click. Both threw
  the same `TypeError: (0, x.default) is not a function`, from different `@turf/*` functions
  (`kinks`, `bboxPolygon`). kepler's packages `require()` the draw editor, so webpack resolved
  `@deck.gl-community/editable-layers` to its CommonJS build — where esbuild's node-mode interop
  (`__toESM(require(...), 1)`) hands every turf _default_ import the module's exports object
  instead of its function, faithfully imitating how Node itself treats a CJS default. That
  combination is broken by construction; the packages only cooperate through their ESM builds.
  webpack now pins the editor to its ESM build, the same move already made for deck.gl and
  luma.gl, and turf's default imports resolve through the `import` condition to real functions.
  Covered by e2e tests that draw both shapes on a real map — where kepler's actual behaviour
  surfaced: a finished polygon waits in `editor.features` for a layer to be chosen, while a
  finished rectangle never stays there, because kepler applies it to every layer immediately and
  `setFeaturesUpdater` keeps filter-bound features out of the editor.

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
