# Changelog

1.0.0 is the first release published to the Grafana plugin catalog, so there is no earlier release
for it to be a change against — the entry below lists what the plugin **does**, not what changed to
get it there. From 1.0.0 onwards, each release documents what changed since the one before it.

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
