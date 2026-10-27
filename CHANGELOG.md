# Changelog

1.0.0 is the first release, so there is no earlier release for it to be a change against — its
entry lists what the plugin **does**, not what changed to get it there. From 1.0.0 onwards, each
release documents what changed since the one before it.

## Unreleased

- **A click on a map with many rows is no longer lost.** deck finds what is under the pointer as
  the button goes down, before it starts timing the press, and it took a press longer than 250 ms
  for something other than a click. On a map with many rows that search alone could take longer,
  so a click on a point published nothing and opened no popup, while the hover tooltip kept
  working. A press that does not move now counts as a click for up to two seconds.

## 1.6.0 (2026-10-26)

- **A map follows a Time Brush frame by frame.** A map whose time window comes from dashboard
  variables (`timeSync: variables`) hears the window a Kepler Plus Time Brush writing the same
  variables says on Grafana's event bus as it plays (`ubica-time-window`), and moves its time filter
  there at once instead of a write at a time; while the brush plays, the variables trailing it
  neither move the map back nor get its window written over them. Only a map with a visible layer
  that draws the rows its time filter covers follows frame by frame; one whose rows come from a
  query over the window, with a time filter that only picks a scene, follows the variables at their
  pace, instead of redrawing every frame for nothing.
- **A map keeps the time window its variables give it**: when its queries answered again, or kepler
  registered the map again, a map with `timeSync: variables` could take its fresh, unnarrowed time
  filter for a move and publish the whole domain over the window a Time Brush had set, seconds
  after load. The variables now keep the first word on a new time filter.
- **A map in a Mosaic selection keeps the others' window** when its query answers again: kepler
  rebuilds the filter from its saved form with the new rows, and the link used to take that for a
  move of the map and drop the clause the other panels had landed on it.
- **A drawn area cuts the Symbols layer**: a figure applied to the map kept every row of a Symbols
  layer while the point layer beside it was cut, because kepler's polygon filter keeps every row of a
  layer type it does not know. The panel's build now teaches it to test a layer that asks for it by
  its position, as it tests a point, and the Symbols layer asks; kepler's figure menu lists it among
  the layers a drawn polygon can be applied to.
- **The drawn area follows its variable**: with **Publish drawn area**, an area that reaches the
  variable from elsewhere is drawn on the map and applied to every visible layer as a polygon
  filter — a shared link, the back button, another panel writing it — and an emptied variable takes
  the figures off the map. Clearing the area from a Chaski filters panel used to leave the figure,
  and the map filtered by it, while every other panel counted the whole map. A figure the saved
  configuration restores with the same area is kept, not drawn twice.

## 1.5.0 (2026-10-24)

- **Linked to a Mosaic selection**: **Cross-filtering → Mosaic selection** names a Selection of the
  Chaski app's Mosaic panels, and the map takes part in it like a brush, with no variable in
  between. Each range, time or multi-select filter on the map is a clause on its column, sent while
  the slider moves, and the Mosaic and filters panels redraw under the pointer (50–90 ms a move on
  200,000 rows); their brushes and picks land on the map's filter of the same column, made for them
  if the map had none, as a filter in the browser with no query run again. A histogram of the same
  column shows the map's window as its brush, and the last one moved wins. **Mosaic location
  columns** (`lng, lat`) add the map's place: the figure drawn on it keeps the rows inside (**Filter
  by the drawn area**, on), and what it shows can be a bounding box (**Filter by the view**). Needs
  the Chaski app 2.2 or later; a time filter that follows the dashboard time range stays out of it.
- **Identifiers keep their leading zeros**: kepler types a column by its values, so a column of
  digit strings became a number and lost its leading zeros — a census tract `06047001901` reached
  the map, its tooltip and its click variable as `6047001901`, which matched nothing in the
  dashboard's own queries. A column with a value like that now stays text, as the query sent it;
  other numeric text is still read as numbers.
- **Shift+click adds to the selection**: on a click mapping whose variable is multi-value,
  Shift+click adds the entity to what the variable holds, or takes it out if it is already there,
  and the halo rings them all. A plain click still replaces the selection, and a Shift+click on
  empty map leaves it alone. Single-value variables behave as before.
- **A selection the query flags, and the rest dimmed**: **Cross-filtering → Highlight rows where**
  names a column, and the rows where it is true (or 1) are ringed in amber as a click's selection
  is. A selection of thousands of rows — what a chart's brush caught, worked out by the query from
  the brush's edges — then never travels in the URL, where a shared link that long fails. **Dim the
  rest** covers every other row under a veil of the base map's tone while the selection marks
  something on the map, with either kind of selection; the veil, like the rings, never takes a
  click. **Selection outline** picks how the selection is outlined: **Auto**, the default, keeps the
  amber on a map that dims nothing and, under the veil, draws a thin line in the base map's
  contrast colour round up to 50 shapes and no outline beyond; **Amber**, **Thin** and **None** fix
  one.
- **Fit to data when a variable changes**: a new option under **Cross-filtering**,
  `fitOnVariables`, names the variables that move the map's rows somewhere else — a state picker,
  a route, a city. When one changes, the map frames the new rows as it does on load, at the zoom
  they need; until now a refresh never moved the viewport, so a map switched from Illinois to
  California went on showing Illinois, empty. Rows that arrive in steps, as a chain of browser
  datasets answers first with the old rows or none, are framed once they have moved, and for a few
  seconds after; then the map is the user's again, and a refresh or any other variable leaves it
  where it is.
- **zod 4.6.7**: zod, which loaders.gl's vector tiles bring in, moves from 4.5.4 to 4.6.7 for
  GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404), a validation of an unbounded array that could exhaust memory.
  The plugin catalog's validator now rejects the older version.

## 1.4.0 (2026-10-20)

- **kepler.gl 3.3.0-alpha.17**: a layer card's zoom, duplicate, `{ }` and remove buttons move into a
  ⋮ menu on the card. **Export data** writes GeoJSON, GeoParquet, Shapefile, GeoPackage, KML and KMZ
  as well as CSV; kepler fetches the GeoPackage and GeoParquet writers' WebAssembly from
  cdn.jsdelivr.net and unpkg.com, and the plugin ships both instead, so an export calls no host but
  Grafana. Filters gain **Filter out** and a 12/24-hour clock, and a range or select filter can span
  several datasets, as a time filter already could; arcs and lines can end in an arrow; cluster,
  hexbin and grid layers can label their counts; the tooltip can show times in a chosen time zone;
  playback can step by interval; and **Interactions** gains a legend section, fading by zoom and a
  map name and description shown on the map. With the coordinate interaction on, a right-click on
  the map offers to copy the coordinates under it. The WMS layer's new **Allow hover** switch starts
  on in this panel, though kepler starts it off: a click on a queryable WMS is what writes the value
  under it to the click variables, and saved maps keep doing so. The time slider's incremental
  window reaching the last of the data, a fix this panel carried, now comes from kepler itself, sent
  upstream from this project; nothing on the map changes with it.
- **The data table opens over the page**: kepler's dialogs — a dataset's data table, Add Data, the
  exports, the delete confirmation — opened inside the panel, which cut them at its edges. The
  table's close button was cut off with the rest, and the dialog's backdrop stayed over the map and
  took every click. They now open over the whole dashboard, as kepler draws them, and close from
  their ✕.
- **The map's name and description are saved**: what is typed under **Interactions → Map info**
  now survives **Save map**, kept beside the configuration as kepler's own **Export map** keeps it,
  and comes back when the dashboard loads. Pasting a map exported from kepler.gl brings its name and
  description too. Until now both were gone on the next load.
- **Clicks apart from tooltips**: a layer class that kepler does not ship can answer a click through an
  optional `getClickData()` method, which the click variables and the click-to-box read before kepler's
  `getHoverData()`. A layer that hides its tooltip by answering `getHoverData()` with nothing can still
  hand a click its row. kepler's own layers answer as before. This is the seam Kepler Geospatial Maps
  Plus uses for its Sparkline's dot and card with the tooltip off.
- **No `<style>` elements**: the amber of the panel's own layers in **Add Layer** comes from a
  scoped Emotion class instead of a `<style>` element drawn beside each icon. The icons look the
  same.

## 1.3.0 (2026-10-16)

- **No code from third-party hosts**: loaders.gl, which reads every 3D tile, glTF model and file
  dropped on the map, fetched its worker scripts from unpkg.com, and Google's Draco decoder —
  JavaScript and WebAssembly — from www.gstatic.com; every Draco-compressed mesh, Google's
  Photorealistic 3D Tiles among them, did. The Draco decoder is now compiled into the plugin with its
  WebAssembly beside it, the Basis/KTX2 texture decoders and Parquet's WebAssembly ship in the
  plugin's `loaders/` folder, and loaders.gl parses on the main thread instead of starting workers.
  One setting at load covers every copy of loaders.gl in the bundle, so a library it does not name
  misses on the plugin's own host rather than reaching unpkg. A Mapbox base map no longer loads its
  right-to-left text plugin from api.mapbox.com either; the plugin's MapLibre maps never did.
- **No raster tile server by default**: the **Raster tile server** option used to fall back to
  `https://titiler.xyz`, Development Seed's public demo, which was then handed every COG and Zarr
  URL a query returned, a presigned link's signature included, without anyone having chosen it.
  Left empty, it now means no server: such a query draws nothing, and the panel shows a notice
  naming the query and the option to set. A `.pmtiles` archive, a WMS and an ArcGIS Image Service
  need no server and are unaffected. kepler's own Add Data → Tileset form starts from an empty
  server list too, though for a bare `.tif` it still fills in titiler.xyz itself, in the form, where
  the editor sees it. **Change:** a panel that left the option empty and drew imagery through the
  demo now shows the notice instead; type `https://titiler.xyz` into the option to keep that, for
  public imagery.
- **Symbols anchor where you choose**: a new **Anchor** puts the centre, an edge or a corner of a
  symbol on the row's position, shapes and pictures alike. A shape's edges and corners are those of
  what it draws, so an arrow anchored at its bottom has its tail on the point and a vector drawn from
  a station starts at the station. **Turn about** chooses whether a turned symbol pivots on that
  anchor or spins about its own centre. The centre keeps each glyph's own point, so no saved layer
  moves. With **Use the column's number** on, the size range is no longer offered, as it is never
  read then.
- **Save the map from the map**: while the panel is open in the panel editor, the map shows a
  **Save map** button along its top edge, just right of the side panel's toggle. It saves the map
  configuration exactly as **Map configuration → Save current map configuration** does, and says
  **Saved** for a moment once it has, so shaping a map no longer means scrolling to the end of the
  options after every change. The dashboard still has to be saved. The button is never shown on the
  dashboard, in kiosk mode, in a solo panel or on a public dashboard.

## 1.2.1 (2026-10-14)

Nothing on the map looks or behaves differently: this release changes how the plugin is built.

- The development build no longer lints files as they change: `eslint-webpack-plugin` is gone from
  the build and its dependencies. It brought in `braces`, whose every release carries a high
  advisory with no fix (CVE-2026-93687), which the plugin validator reports. It never ran in the
  production build; linting stays with `npm run lint` and the editor.

## 1.2.0 (2026-10-13)

- **A shared link opens the map on its place**: a link that carries the lat/lng pair of a *center*
  mapping — a shared dashboard URL, or a table's data link that opens the dashboard afresh — now
  opens the map centred there, at the mapping's zoom when it names one, instead of on the saved
  framing, where the selection could be one dot among hundreds. Bearing and pitch stay the saved
  ones. Only the first load does this: a later save or edit frames the map as the author left it.
- **The selection halo reads on orange layers**: its amber ring and outline are now drawn over a
  dark casing, so a selected row stands out on a layer coloured close to amber.
- **Halos on layers kepler does not ship**: a layer class that kepler does not ship can ask to be
  marked by the halo through an optional `selectionHaloMark()` method, naming a ring (with its own
  size per row, or none for a row it does not draw) or an outline. kepler's own layers are marked
  as before. This is the seam Kepler Geospatial Maps Plus uses for its own layers.

## 1.1.0 (2026-10-07)

- **The side panel names the plugin**: its header shows the plugin's own logo and name, linked to the
  documentation, with "powered by kepler.gl" under them, linked to kepler.gl. It used to show
  kepler.gl's logo alone, which read as if the map were kepler.gl's product.
- **Base maps without CARTO by default**: since 23 Sep 2026 CARTO asks for a key, and without one its
  raster tiles — the picker's thumbnails among them — carry an "API key required" watermark. The
  defaults are now OpenFreeMap's styles (Positron, Bright, Liberty, Dark, Fiord), with no key or
  account. **Change:** a panel on _Match theme_ now shows OpenFreeMap Dark or Positron instead of
  CARTO's Dark Matter or Positron. Dashboards saved on Dark Matter, Positron or Voyager still open on
  CARTO, now labelled as such, and a new _CARTO API key_ option keys every CARTO request. Thumbnails
  ship with the plugin. The Map Layers switches are truthful now: a _Points of interest_ switch for
  OpenMapTiles styles (translated), _3D Building_ only where the style draws its own buildings
  (Liberty; it did nothing on CARTO without a Mapbox token), switches that match upper-case layer
  ids, and a self-hosted `style.json` that shows its switches and keeps their states when the base
  map changes.
- **Grafana Assistant awareness**: on a Grafana that has the Assistant, the panel now grounds it in
  the map — the page context carries each query's fields and row counts, the base map actually
  shown, the saved filters and viewport, and always the dashboard's time range — and two starter
  questions appear in the sidebar, once per dashboard however many kepler panels it holds. Nothing
  is sent to any backend, and on a Grafana without the Assistant the panel is unchanged. The
  panel also exports its schema knowledge as a small skill text (`baseAssistantSkill`) that an
  organisation can paste as standing Assistant instructions, and an `AssistantComposition` seam so
  an app embedding the panel extends the digest instead of registering a competing one. The skill
  spells out the dataset-id rule for hand-written layers: query B's data is dataset `grafana-B`.
  A second export, `dashboardAuthoringSkill`, teaches an assistant to *build* dashboards with the
  panel — the saved map's exact JSON shape (the mandatory `"version": "v1"`, `visualChannels`
  beside `config`, a worked example held to the panel's own parser by tests), when a `mapConfig`
  is needed at all, and to save an absolute time range over historical data. Tried against the
  real Grafana Assistant: without these lines it picks unregistered base maps and writes configs
  the panel silently drops; with them it restyles the map correctly on the first try.
- **Temporal cursor**: the map joins Grafana's shared cursor. Hovering a Time series graph draws an
  amber marker where each vehicle was at that instant, on Point layers and on Trip layers in both
  table and timestamped GeoJSON form, and the same instant as a line on the map's time bar. With
  *Map hover drives graphs* on, hovering a Point sample or the time bar moves the graphs' crosshair
  instead. Off by default; nothing is queried while hovering. A new *GPS truck track* dashboard on
  the development benches shows it on a real road with a synthetic truck.
- **Playhead variable**: a new Map option writes the trip animation's current instant to a dashboard
  variable, as UTC ISO 8601 — once on load, during playback at the *Minimum interval while playing*,
  and where it stops — so a chart can draw a bar at the moment the map is playing, or a SQL panel can
  count what is on the road right then. It is independent of *Time range sync*. The interval option
  now also shows when this one is set.
- **Markers and symbols stand on the relief**: over the *Satellite + relief* and *Topographic +
  relief* basemaps, markers and symbols used to be drawn at sea level under a camera aimed at the
  ground, so on a hill higher than the centre of the view they sank into it, and they slid as the
  map panned. They are now drawn at the ground's elevation, labels, shadows and outlines included,
  and a dragged marker lands on the ground under the pointer. Other layers are unchanged.
- **Symbols shrink when zooming out**: a new *Shrink when zooming out* switch in the symbol layer's
  Size group. Off by default, so a symbol keeps its pixel size at every zoom as before. On, every
  symbol — picture, outline and shadow included, and its label's clearance — is scaled by
  2^((zoom − reference zoom) × rate): never above the set size when zooming in, never below a fifth
  of it. *Use current zoom* sets the reference zoom from the map as it is.
- **Markers stay on top**: a markers layer is now drawn above every other layer, whatever its place
  in the layer panel, and above the base map's roads and labels when the base map is set to draw
  those over the data. Until now such a base map covered the markers. Dragging them works as before.
- **kepler.gl 3.3.0-alpha.15**: the layer, filter and effect cards in the side panel gain kepler's
  `{ }` button, which opens that item's settings as JSON to edit in place. The time widget does not
  get the one kepler puts there too: it is on the map for every viewer and what is typed into it is
  lost on the next refresh. A time zone or time format chosen for the trip animation is now kept
  when the map is saved; it used to come back as UTC. Three fixes this panel had been carrying for
  the layer order after a refresh, the Flow layer's arrows after a refresh and the time slider drawn
  under its own histogram now come from kepler itself, sent upstream from this project; nothing on
  the map changes with them.
- **3D Tiles round the whole world**: Cesium OSM Buildings, Google Photorealistic 3D Tiles and
  Google's tiles served through Cesium ion now draw; until now each of them drew nothing. A tileset
  that spans the whole world is lowered by the ground under the centre of the view, along the
  vertical there, and again as the view moves, so a city at 2 550 m shows at street level as well
  as one by the sea. *Sit on the ground* and *Height adjustment* apply to it that way.
  - A tileset described by regions is no longer culled where it stood before being put on the
    ground, and one whose regions reach round the world is no longer culled away altogether.
  - A tile with nothing to draw in it no longer switches the whole layer off.
  - A Cesium ion asset that ion serves from elsewhere is loaded from there, and the ion token is no
    longer sent to the host ion names for it.
  - Tiles already drawn now move with the tileset when the ground under the view or the *Height
    adjustment* changes; until now they stayed where they were first drawn, for any 3D tileset.
  - A *Height adjustment* of a few metres now moves a tileset that spans the whole world.
  - Adding a tileset that spans the whole world no longer throws the map out to the whole planet.
  - A tileset with no transform of its own is put on the ground along its own vertical, where it
    was moved along the Earth's axis: near the equator that slid it sideways instead of down.
  - Large buildings of Cesium OSM Buildings, and anything else far from the centre of its tile, are
    now drawn where they stand, within a few metres, near the equator: over Cuenca the stadium sat
    some 140 m south of itself on the base map. Elsewhere the worst error is roughly halved; a few
    tens of metres can remain far from a tile's centre at mid and high latitudes.
  - The buildings of Cesium OSM Buildings, and of any worldwide tileset that keeps its buildings the
    same way, now each sit on the map, on the hills too: lowered by the ground under the view, those
    on higher ground floated above the map, by hundreds of metres round Cuenca. *Height adjustment*
    lifts them all together, and with *Sit on the ground* off they stand at their real altitude.
    Google's 3D Tiles, whose mesh is the ground itself, keep following the ground under the view, and
    a smaller tileset of buildings — a city model, a BIM model — is still lowered as a whole by its
    base. Each building part is placed by its own lowest point, so a part that starts above the
    ground — an overhang, a skybridge, the upper section of a tower — may land at the ground with the
    parts below it. Buildings far from the centre of the coarse tile they come in are hidden rather
    than drawn out of place or in the air.
- **Charts**: kepler's charts panel gets its button in the map control — big numbers, bars, lines,
  heatmaps and pivot tables over the map's data, saved with the map. Its **tooltip charts** plot an
  entity's own history in its popup: hover a station and see its day. With kepler's tooltip compare
  mode, pinning one entity and hovering another shows both charts side by side, and only the pinned
  popup offers **Select**. A chart's cross-filters narrow the map and its charts, and reach a
  dashboard variable only through a mapping that asks for them. A saved compare mode now survives
  loading the map, which kepler itself drops. The sources bench gains `mareas-ecuador`, INOCAR's
  tide gauges live, with tooltip charts and a pinned heatmap.
- **A chart's selection can drive the dashboard**: a variable mapping with the new source **Chart
  cross-filter** publishes what a chart in kepler's charts panel filters on a column, one way. On
  `mareas-ecuador`, a click on a heatmap cell sets the port and the three-hour block, and a time
  series under the map draws that port's tide minute by minute.
- **Variable mappings on a column kepler renames**: a mapping on a column that a role renames in
  kepler's dataset, as `vehicle_id` reaches kepler as `trip_id`, used to find no filter, no clicked
  value and no halo: the options name the query's column, and kepler knows it by the role's name.
  Mappings that read a column now follow the rename. *Coordinate* and *center* mappings, whose
  field means nothing, are untouched.
- **A dashboard range pushed during a refresh**: a refresh parks the time filter until its dataset's
  new rows land. A dashboard range pushed in that gap used to make a second time filter on the new
  window, and the parked one came back on its old window ahead of it, where the map and every sync
  read it. The push now waits for the parked filter and lands on it once it is back.

## 1.0.1 (2026-09-23)

1.0.0 never reached the plugin catalog: its review turned it away because the panel loaded
MapLibre's stylesheet into the whole Grafana page. This release fixes that, and nothing on the map
looks or behaves differently.

- MapLibre's stylesheet now applies only inside the map panel, so it no longer reaches anything
  else on the page that uses MapLibre's class names. Every rule keeps the weight it had, which is
  why the map itself is unchanged.
- A self-hosted base map style whose path has no leading slash (`public/…`) now resolves against
  the Grafana instance, sub-path included, instead of against the dashboard's address, which
  pointed it at a page that does not exist. Paths starting with `/` and full URLs resolve as
  before.

## 1.0.0 (2026-09-23)

Interactive kepler.gl maps inside Grafana dashboards, fed by any Grafana data source: points,
trajectories, origin-destination flows, symbols turned to a bearing, and animated velocity fields
built straight from a query's columns; cloud-native imagery walked by the dashboard clock; and five
cross-filtering channels wiring the map into the rest of the dashboard through variables. No account
and no Mapbox token are needed for any base map.

### Compatibility

Grafana **12.0.10 or later within 12.0**, **12.1.7 or later within 12.1**, and **12.2.5 or later**,
13.x included. The earlier patch releases are excluded rather than untested: Grafana only added
`react/jsx-runtime` to its SystemJS import map in those three, and without it the plugin fails to
load outright. The end-to-end suite runs on every push against the whole matrix of images Grafana's
own `e2e-version` action resolves from that declared range — the floor of it, the current releases
and the nightly — so a break shows up at whichever end it happens at.

Requires **WebGL 2**.

### Data in

Any Grafana data source works — the panel reads data frames, not a specific protocol.

- Each query becomes one kepler dataset, identified by its `refId`, so a single panel can overlay
  several — a road network over a heatmap over a set of trajectories.
- Column autodetection for latitude/longitude, time, trip id, geometry, H3, origin/destination
  pairs, bearing and magnitude, overridable per query under **Field mapping** — including switching
  a detected role off, which is how a trajectory table is drawn as loose points instead of trips.
- Geometry from GeoJSON, WKT, or raw WKB/EWKB hex, so a plain `SELECT geom` from PostGIS renders
  with no `ST_AsGeoJSON` wrapped around it. Whatever the format, the column reaches kepler as a
  geometry object rather than a JSON string it would have to parse back, which keeps maps with many
  rows quick to draw.
- H3 indices and S2 tokens both render without coordinates — the grid cell's own identifier is the
  geometry. H3 also drives origin-destination flows, as a pair of hexagons instead of two
  coordinate pairs.
- EPSG:4326 only. The panel renders WGS84 longitude/latitude degrees and does not reproject;
  project in the query if the source is not already in it.
- kepler's own **Add Data** dialog does not read Excel workbooks. The library kepler reads them with
  has security advisories and no fixed release, so it is left out, and an Excel file is refused with
  a message to save the sheet as CSV.

### Layers the panel builds for you

- **Points**, from a latitude/longitude pair or a geometry column — kepler's own detection, no
  layer setup needed.
- **Trips**, from a trip id, a time and a position: an animated Trip layer with a playback
  timeline. Table-column mode (the default) keeps one row per point and every other column with
  it, for colour, filters and tooltips; GeoJSON mode folds each trip into a single row carrying
  only the path, far smaller for a large trajectory table.
- **Origin-destination flows**, from a pair of coordinate pairs or a pair of H3 indices, drawn
  straight, curved, or animated.
- **Symbols**, from a position and a numeric bearing — a fleet, a set of vessels, a network of
  weather stations. One mark per row, turned to the column's degrees. The **Symbols** section below
  says what it can draw and how it is styled.
- **Velocity fields**, from a grid of speed and direction, or of u/v components — GRIB2's
  `ugrd`/`vgrd` included — drawn two ways over the same grid, and a third from a single column of
  values. The next section covers them.

The panel's own layer types carry an amber icon in kepler's layer list, so it is always clear which
of them kepler ships and which this plugin adds. Where one of them supersedes a layer kepler would
have guessed from the same columns — the Point layer under a symbol field, kepler's own Flow Field
over a velocity grid — the guess is removed rather than stacked underneath, and stays available by
hand in **Add Layer**.

### Velocity fields

- **Streamlines** traces particles through the grid and animates them. It has a panel of its own:
  density, zoom response, line width and length, trail length, speed contrast, cycle, lifetime,
  seamless looping, smoothing, height and vertical exaggeration, next to a colour ramp over each
  line's mean speed, and width and opacity that can follow speed as well. The field re-traces as
  the map is panned or zoomed, so its density and line length hold steady at any tilt or bearing,
  and several pressure levels can be stacked in the vertical.
  - The animation runs on **a clock of its own**, not on kepler's playback: the lines keep moving
    while the dashboard's own timeline sits still, and stop by themselves when the panel scrolls out
    of view or the browser tab goes to the background. It can be switched off, and it respects the
    operating system's _reduce motion_ setting.
  - A query can carry **the whole forecast** and let the dashboard's clock choose the hour: the
    map draws the latest hour the time filter leaves standing, and re-traces as the window moves.
    Hours already traced are kept, so walking back and forth through a forecast is free.
  - Seeds are **anchored to the ground**, not to the screen, so a line stays over the same place as
    you pan instead of sliding with the camera. Where the altitude column varies across the grid the
    lines are laid **on the terrain**; where it is flat to within a tenth, the level is drawn at its
    mean height.
- **Vector field** draws the same grid as discrete symbols instead: arrows, classified arrows, or
  **wind barbs** in the meteorological convention. Placement is either a screen grid at a spacing
  you set in pixels, or one symbol per data cell; size is fixed or follows speed, and the data's
  own speed unit — m/s, km/h, knots, ft/s, mph — is declared on the layer so the barbs mean what
  they draw. Switching a Streamlines layer to this type keeps its columns.
- **The gradient of a value.** A single numeric column — terrain, pressure, a concentration — is a
  field too. Pointed at one, either layer traces the flow downhill, uphill, or along the contours,
  with no velocity columns involved at all.
- A grid that is really **scattered stations** rather than a lattice is drawn as symbols, which is
  the honest answer: streamlines through a dozen airports would be interpolation the data does not
  support.

### Symbols

- **A catalogue of more than a thousand shapes**: a handful of plain ones the plugin draws itself —
  arrow, circle, square, triangle — plus Maki's 215, Temaki's 556 and 272 of the UN OCHA
  Humanitarian Icons, all three CC0. They are sorted into sixteen themes of our own — transport,
  water, health, energy, hazards and the rest — with a picker that opens on the category the symbol
  in use belongs to and draws each glyph beside its name.
- **Turned by a column** of degrees, or held at a fixed angle. A wind direction is read as *where
  the wind comes from* and anything else as *where it goes*, and the convention can be set either
  way on the layer.
- **Sized** in pixels, or by a column over a size range.
- **Styled**: an outline in any colour and thickness, a drop shadow with its own intensity and
  distance, a gradient that lightens each symbol from its tip towards its tail, and a label from
  any column, the way the point layer labels. Symbols can be laid flat on the map or made to
  **stand upright** in a tilted 3D view.
- **Thinned on demand**: a minimum spacing in pixels drops the marks that would overlap at the
  current zoom, so a dense fleet stays readable without filtering the data.
- **A picture per row.** Instead of a shape, the layer can draw an image: one for the whole layer,
  or a different one per row from a column of URLs. Pictures are fetched as images rather than
  through loaders.gl, so they work under a strict Content-Security-Policy, and a small one can be
  uploaded into the layer itself (up to 75 KB) rather than hosted. The anchor is the centre or the
  bottom tip, and the layer panel reports exactly what went wrong with any that fail — a blocked
  cross-origin fetch, an `http` picture on an `https` Grafana, a timeout, a file that is not an
  image — instead of drawing nothing and saying nothing.
- **Markers**, a layer of its own: draggable reference points, each bound to a pair of dashboard
  variables. Drag one and its pair is written once, on release, so a query hanging off it — an
  isochrone service, a distance — runs once per gesture rather than on every pointer move. The
  variables are the source of truth, so a marker also moves when the pair is changed from a text
  box or arrives in a shared link. It draws nothing from its dataset and is saved with the map.

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
- **Band combinations.** A query that also points at the scene's **STAC item** can be redrawn in
  false colour without touching the query: true colour, forest burn, infrared, or the NBR and NDMI
  indices. The composites are built by the tile server in a single request; the indices are computed
  in the browser from two bands of the item, each with a diverging ramp of its own. The option
  interpolates a dashboard variable, so a dropdown on the dashboard can drive which combination the
  map is showing.
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
  terms of use entirely. Its URL is interpolated before it is fetched, so it can be assembled from
  dashboard variables, and a path relative to the Grafana instance works as well as an absolute
  one. A variable that expands to nothing counts as no URL rather than as a broken one.
- Follows the dashboard theme, base map included.
- **WebGL 2** required — everything the map draws goes through deck.gl, with no canvas or SVG
  fallback. Each map holds two WebGL contexts, so the practical ceiling is around eight maps on one
  dashboard page.
- **Saved map configuration**, stored with the dashboard: layers, styling, filters, interactions,
  split state, base map. Configs pasted from kepler.gl, Foursquare Studio or Dekart are accepted,
  and a layer added by hand through kepler's own **Add Data → Tileset** is saved as a lightweight
  descriptor rather than as data. A stored configuration that names a base map outranks the **Base
  map** option; one that names none — as a hand-written or pasted configuration commonly does —
  leaves the option in charge.
- **Split view** — two synchronised panes with different layers visible in each, or a swipe
  curtain between them.
- Layer configuration survives a data refresh: rows are swapped in under the layers rather than the
  dataset being torn down and rebuilt, and the layer order you saved is the order you get back.

### Dashboard integration

- **Time range sync**, in three modes: the dashboard drives the map's time filter one way, both
  directions couple them, or the slider's window publishes to two dashboard variables so the map
  keeps its whole dataset while the rest of the dashboard follows the slider.
- **Paced publishing while playing.** Playing the slider can write its window to those variables on
  every frame, which is how one map animates a whole dashboard. The minimum interval between two
  writes is yours to set, 250 ms and up, 1500 ms by default; and where a data source on the page
  announces when it is busy, the map waits for the panels answering the previous window before
  writing the next, rather than queueing work nobody will see. Playback no longer stops when the
  map's own queries are answered — a variable change, a Refresh, an auto-refresh.
- Maps on a dashboard can **share a clock** with each other — time filter and trip playhead alike —
  over an in-browser channel, with no dashboard variable and no query re-run.
- **Explorer results on the map.** On a Grafana with the Chaski datasource, the SQLRooms explorer can
  send a query's result to the map (`ubica-explorer-to-map`). It shows as a dataset of its own for
  the session, up to 200 000 rows, and is not saved with the dashboard.

### Cross-filtering

Five channels, wired under **Cross-filtering**, each writing to a dashboard variable for the rest
of the dashboard to read:

- **Filter** — a select, multi-select or text filter set on the map, both ways; a numeric range
  filter publishes as a min/max pair the same way.
- **Click** — the clicked entity's value of a column, map to variable.
- **Coordinate** — the clicked place, as a lat/lng variable pair. The same pair can also be read
  back the other way, to recentre the map from outside it — a table row's data link, a pair of
  text boxes — at an optional zoom.
- **Drawn area** — the polygon or rectangle drawn on the map, as WKT. A click can set it too, as a
  square of a size you choose around the entity, without anything being drawn by hand.
- **Viewport** — the map's own bounding box, published for the *other* panels on the dashboard;
  feeding it back into the map's own query would only ever shrink what the map has to show.

The Markers layer writes to variables too — a pair per marker — but it is configured on the layer
rather than here, since the markers are part of the map, not of the query.

Two things make a selection legible rather than invisible:

- **Select from the popup.** On a map whose selection reloads data or switches a tab, a click that
  publishes immediately makes looking expensive. Switched on, a click only opens kepler's popup with
  the entity's details, and the popup's **Select** button is what publishes — **Clear** is what
  empties.
- **The selection halo.** Whatever the click channels have published is ringed on the map in amber,
  above every layer and deaf to clicks of its own: points get a ring, polygons and paths an outline.
  It is read from the variables in the URL rather than from kepler's clicked entity, so it survives
  a data refresh and is there on a shared link — which is what makes a dashboard opened from a link
  show *which* entity the numbers beside the map are about.

---

The 0.1.0, 0.2.0 and 0.3.0 series that came before 1.0.0 was developed on GitHub and never
published to the Grafana plugin catalog. Its record is in the git history rather than here.
