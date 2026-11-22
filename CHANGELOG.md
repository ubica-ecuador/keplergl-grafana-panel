# Changelog

1.0.0 is the first release, so there is no earlier release for it to be a change against — its
entry lists what the plugin **does**, not what changed to get it there. From 1.0.0 onwards, each
release documents what changed since the one before it.

## Unreleased

- **Rows that live for a while, at one moment.** A query with both `valid_from` and `valid_to` gets
  its time filter set up with `valid_to` as kepler's end time field and a window of one moment, the
  last: the map shows the rows alive then, an empty end being a row still alive, and playing or
  dragging the moment goes back through the history; the histogram counts the rows alive. The
  Spatial Catalog gives an Iceberg table's whole history so, and the map shows the table as each
  commit left it. With the dashboard driving the map, the moment is the time range's end. Done once,
  on the filter the panel makes: one changed or removed, or a saved map's, is left as it is.
- **A catalog's boxes as outlines.** A frame whose `meta.custom.layer` says `outline: true` has its
  polygons drawn as outlines, not filled: shapes that say where things lie, not what they are. The
  Spatial Catalog sends it on a Catalog search, whose `footprint` boxes, filled, stacked into one
  tinted slab over the map. Only the layer kepler makes for the query changes, as it makes it: a
  saved map keeps what it saved, and the layer's Fill switch turns the fill back on. Points and lines
  are drawn as before. Read whether or not the frame names its `key`.
- **The viewport in one variable.** *Publish viewport* takes, besides or instead of its four edges,
  one variable for the whole box (`viewportVariables.view`): a WKT `POLYGON`, as the drawn area is
  written, or `west,south,east,north` (`viewFormat: 'bbox'`). A data source that reads an area takes
  it as is (the Spatial Catalog's area: `$view`); SQL reads it as `ST_GeomFromText(${view:sqlstring})`.
  Published with the edges, in the same write, and not written again while it holds the box.
- **A WMS layer in one of its styles, and a service's legend in the map's legend.** A query's
  `wms_style` (or `wms_styles`; not `style` alone, a column of any table of buildings) on the row
  that names the WMS is the `STYLES` of every request: the picture, the tiles a relief base map
  draws, and the click (`GetFeatureInfo`), so a click is answered for the style on screen. Empty is
  the service's default. A change of style (a variable over the styles a catalogue lists) asks for a
  new picture of the same layer, the way a change of date does: no new dataset, the view does not
  move, and the layer keeps its name, opacity and place set in the layer panel. kepler's map legend
  (the legend button in the map control) now shows the legend of the style drawn: the row's
  `legend_url` (or `legend_graphic_url`) when it gives one, else the service's `GetLegendGraphic`
  of that style; kepler's own showed the default style's whatever was drawn. An `esri_url` row's
  `legend_url` is shown there too: a picture as it is, ArcGIS's `…/ImageServer/legend` or
  `…/MapServer/legend` fetched as JSON (`f=json`) and drawn as swatches and labels in the legend's
  look, a stretch of many values as one bar between its end labels, and only the layer drawn of a
  `…/MapServer/<id>`; a service that refuses CORS shows none. An ArcGIS service layer no longer shows
  a colour swatch of its own there, as kepler's WMS layer does not. A row's `title` column names the
  service's dataset and layer, where a catalog query's name is the same for every service it lists.
  A change of `esri_rendering_rule` (or of `legend_url`) rebuilds the service's dataset as before,
  which keeps the layer's settings and the view.
- **A legend for a query's tiles, in the map's legend.** A query's `{z}/{x}/{y}` picture tiles
  (`tiles_url`) take the row's `legend_url` (or `legend_graphic_url`) as a WMS does: a picture, shown
  in kepler's map legend under the layer's name (the layer's `getLegendImageUrl`), such as a WMTS
  style's `LegendURL`, which the Spatial Catalog sends for the style chosen (GeoServer's
  `GetLegendGraphic` of it, for a GeoWebCache WMTS). ArcGIS's `…/legend` JSON is not drawn for tiles;
  vector tiles and archives take none. The tiles' layer no longer shows a colour swatch of its own
  there, as a WMS's does not. A WMTS's other style is another `tiles_url`: on a frame whose
  `meta.custom.layer.key` stays, the new tiles and their legend are drawn on the same layer, which
  keeps its settings, and the view does not move; before, a new address was framed again as a new
  layer, which on a map with no view of its own moved the view to the box on every change of style.
  Tiles without a frame key are framed on a new address as before.
- **A layer's credits and zoom levels from its data source.** Beside its `key` and `bbox`, a frame's
  `meta.custom.layer` may say whom to credit for the layer, `attribution` (a title, `{ title, url }`,
  or a list of either), and the zoom levels its tiles exist at, `minZoom` and `maxZoom`. The credits
  are shown with the base map's, in kepler's attribution: at most four per layer, each one line of
  plain text, linked only to an `http(s)` page. The zoom levels stand in for a query's
  `tiles_min_zoom` and `tiles_max_zoom` when its row has none. Both are read whether or not the frame
  names its `key`, so any data source may send them; a frame without them is drawn as before. The
  Spatial Catalog sends the providers and licence of what a layer draws (a WMS layer's
  `Attribution`, STAC's licensor and producer, an ArcGIS layer's `copyrightText`). A credit is read
  when kepler makes the dataset, so a refresh of the same layer keeps the one it had; a vector
  tileset or a PMTiles archive that credits itself in its TileJSON or header is credited by that.
- **A layer named as its data source names it.** A frame's `meta.custom.layer` may say the layer's
  `title`, and the query's datasets, and kepler's layers on them, take it in place of the frame's own
  name (`rasters`, `features`, `services`) or `Query A`; a row's `title` still names a WMS or ArcGIS
  service. A layer whose name is still one the panel or kepler gave it — the frame's name, the
  query's, a title the query named before, or kepler's cut of a title at what looks like a file
  extension ("CCI Biomass v5.01" made "CCI Biomass v5") — is renamed to the title: a map saved before
  its data source said one, and a query pointed at another layer, which keeps its layers. A name the
  user gave a layer stays. The Spatial Catalog sends the title of the entry a layer draws, or of the
  collection its items belong to.
- **ArcGIS Map Services from `esri_url`.** An `esri_url` ending in `/MapServer` is drawn as an Image
  Service is, a picture of each tile in Web Mercator, by the service's `export`
  (`format=png32&transparent=true`); one ending in `/MapServer/<id>` draws that layer alone
  (`layers=show:<id>`). An `/ImageServer` is drawn by `exportImage` as before. A `tiles_bbox` on the
  row of an `esri_url` frames the view as a WMS's box does: when the map has no view of its own, or
  its view shows none of the box.
- **A raster painted as its query says, through its data source's tile server.** A query's
  `raster_paint` (the tile server's parameters, `bidx=1&colormap_name=viridis`, as the Spatial
  Catalog gives them from what a catalog says of the file) is put on every tile request of its
  raster, each key over the panel's own for the same key, never a second `url`; a query with one is
  painted unless its `raster_painted` says false. A panel with no **Raster tile server** draws a
  query's rasters and Zarr stores through the one its frames name (`meta.custom.tileServerUrl`, a
  Spatial Catalog's *Tile server*), and kepler's Add Data form starts from it; the panel's own still
  wins. Such imagery gets a suggestion card, since a card then has a server.
- **Vector tiles and PMTiles from a query.** A `tiles_url` of vector tiles (`tiles_format` `mvt`, a
  `{z}/{x}/{y}` template, with its TileJSON in `tiles_metadata_url` when the query has one) or a
  PMTiles archive (`pmtiles`, or any address ending in `.pmtiles`) is drawn as kepler's own tilesets
  are: vector tiles with its Vector Tile layer, whose fields it reads from the TileJSON or the archive,
  and an archive of pictures with its Raster Tile layer. What an archive holds is read from its header
  (one request of 127 bytes, once per page) before it is drawn; an archive that cannot be read is said
  over the map. Like raster tiles: one layer per query, never saved with the map, the zoom levels
  from `tiles_min_zoom` and `tiles_max_zoom` where the tileset gives none, and `tiles_bbox` (or an
  archive's own box) framed on, cut to, and no tile asked for outside it. A query's vector tiles start
  as a filled tint under a solid outline with points of four pixels, readable on a dark or a light base
  map; a tileset added by hand keeps kepler's look.
- **A map whose rows the time range hides says so.** When the map's time filter follows the
  dashboard's range and every row of a query falls outside it (Madrid's fountains, inspected from
  2017 to 2025, under "Last 7 days"), the map was empty with no word why. A notice over it now says
  how many rows, from when to when, and to widen the range to see them; it goes as soon as the range
  covers one of them again.
- **A query pointed at another layer is framed on it.** A query switched to another layer with the
  same columns (another GeoParquet file of the same schema, another file of a collection, a layer a
  variable names) kept the view of the old one, which may show nothing of the new. A frame may now
  say which layer it draws, `meta.custom.layer` `{ key, bbox? }` (the Spatial Catalog sends its
  data source, its query's kind and the entries it reads, and the extent the catalog gives). The
  first answer only records the key; an answer with another key frames the map on its `bbox` at
  once, rows or none (the range may hide them all), and without a `bbox` on its rows once they reach
  the layers; another layer with neither leaves the view where it is. A refresh of the same layer
  never moves the view, and a pan after the framing is kept. A query framed on its own `tiles_bbox`
  (a WMS, an ArcGIS service, tiles) is left to that framing, and a query that names its layer is not
  framed a second time when its columns change.
- **A query that now answers something else gets its layers.** A query changed in the editor to
  answer other columns under the same letter (a raster series switched to an Iceberg table's
  features) kept its dataset, emptied of any layer that could draw it: kepler replaces a dataset's
  rows without guessing layers, so the map stayed blank until a layer was added by hand. When the
  columns change and no layer on the query still finds its own, the map now builds the layers a first
  load would and frames them. A refresh with the same columns builds none, so layers removed by hand
  stay removed.
- **A map with nothing to frame stays where it is.** A query that answered no rows (a GeoParquet
  read by an area holding nothing), or rows with no geometry, took a map centred on its data to
  latitude 0, longitude 0: kepler's GeoJSON and Trip layers measured an infinite box for no
  features, and the centring read it as the whole world. Such a layer now has no bounds, and is left
  out of every fit on the data, as a point layer with no coordinates already was.
- **A saved map whose query failed opens on its saved view.** A map whose queries answered nothing —
  its only query failed, or returned no rows — waited for rows that had already not come, so its saved
  config was never applied and it showed kepler's default view over San Francisco. Once the queries
  have answered, a map saved with a view of its own is built from its config; rows that come later
  take the layers it saved for them. A map saved without a view still waits for its first rows, to
  be framed on them.
- **The map says what went wrong.** Over the map, along the top between kepler's side panel and its
  controls, one dismissible box lists each query's error (which Grafana marks only with the panel's
  corner icon), each frame's notices of severity warning or error (the Spatial Catalog's "… is no
  longer in the catalog", "the service refused the time range"; info notices stay in the icon), and
  each query whose layer the panel cannot draw from its columns (a `tiles_url` with no `{z}/{x}/{y}`,
  a PMTiles archive whose header cannot be read, a catalog's service row with no `tiles_url`,
  `esri_url` or `wms_url`, named by its protocol and title). What was closed stays closed across refreshes;
  a new notice, or one that comes back, shows. The raster tile server and Geomap notices sit in the
  same strip, no longer over the side panel.
- **Map tiles from a query.** A row with a `tiles_url`, a `{z}/{x}/{y}` template, is drawn as raster
  tiles with no tile server, as the Spatial Catalog's *Services* query gives any map service that is
  not a WMS (PDOK's WMTS, an OpenStreetMap-style server), or any query returning the same columns:
  `tiles_format` (`raster`; `mvt` and `pmtiles` above), `tiles_min_zoom`,
  `tiles_max_zoom`, `tiles_zoom_ids` (the service's own name for each level, `0:00,1:01,…`, put in
  `{z}`) and `tiles_bbox`. One layer per query, from its first row with an address; the rows stay a
  table, and the layer is rebuilt from the query, never saved with the map. One service per query: the
  first row that names one decides, and in that row a WMS wins over an Esri service, which wins over
  tiles, which win over a raster. The box frames and cuts tiles as it does a WMS (below): the view
  moves onto it when it shows none of it or the map has no saved view, never on a refresh; each tile
  is cut to it (not on a globe), and no tile outside it is asked for, nor any zoomed out past the
  service's first level; a view framed on the box goes no further out than that level, on the box's
  centre (a WMTS of France starting at 6 was framed at 5.35, with no tile to ask for).
- **A WMS layer's box: framed on, and cut to.** A query's WMS row can carry the layer's box,
  `tiles_bbox` (or `wms_bbox`), as text `west south east north` in degrees, as the Spatial Catalog
  gives it. When the layer appears, or the query names another, and the view shows none of the box
  or the map has no saved view, the view moves onto it; a saved view showing part of the layer stays,
  and a refresh never moves the map. The service's picture is drawn only inside the box, so a WMS that
  paints opaque white where it has no data (IGN's Cassini map of France, an RGB PNG whatever
  `TRANSPARENT` says) no longer covers the rest of the world; outside the box a click asks nothing.
  Not on a globe, where the picture is drawn whole; on a relief base map no tile outside the box is
  asked for, but the edge tiles are drawn whole.
- **Kepler in the visualization picker's suggestions.** On Grafana 13 the map is a suggestion when a
  query holds a place it draws without help: latitude and longitude, a geometry, an H3 cell, a
  geohash, both ends of a flow or an ArcGIS Image Service (`OK` for columns called only `x` and `y`, or
  for a bare PMTiles raster or WMS link). Not for a COG, a STAC item or a Zarr store: they wait for a
  raster tile server, which a card, drawn with the panel's defaults, does not have. Its card is a live
  map of up to 5,000 rows with the side panel and the time widget folded. Grafana lists every core
  panel first, Geomap included. Picking the card converts a Geomap's map as picking the panel from
  *All visualizations* does.
- **From Kepler Plus back to Kepler, the map stays.** Changing a Kepler Plus panel's visualization to
  this one keeps its options and its saved map, as Plus keeps this panel's; layers only Plus draws
  are left out when the map loads.
- **A WMS whose address ends in a slash answers.** The panel tidied a WMS address's trailing slash
  away, and a service that answers only with it, as NASA GIBS does at `…/epsg3857/best/` (the address
  its capabilities give), was asked at `…/best`: a 404 without CORS, and the map showed *Failed to
  fetch*. The address keeps its slash; it is still cut at its query and fragment.
- **ArcGIS I3S meshes show again.** An I3S scene layer (an integrated mesh, 3D objects) in the 3D
  Tile layer loaded its tiles and drew nothing: deck.gl 9.4's mesh shader hands luma.gl 9.4's PBR
  module a vertex colour of zero, which luma now multiplies the texture by, so every fragment was
  discarded (deck's own San Francisco example too). And a mesh without texture regions, as Esri's
  integrated meshes are, came out as streaks: the shader's region test is an `#ifdef` on a macro
  deck defines as 0. Both are mended in the layer the panel builds for each tile, and each I3S
  tile's vertices are worked out in 64-bit floats into metres round its own origin, rather than
  from the Earth's centre on the GPU, a metre astray. Ground such a layer with *Sit on the ground*
  off: an I3S root is bounded by a sphere that would lift it as far as it is wide.
- **An I3S mesh one level of detail at a time.** A coarse node was drawn over the finer ones it
  was giving way to while another of its children was out of view, a mottle of blurred and sharp
  patches; it now gives way once every child in view is drawn, as splat tiles do.
- **A split map's loading bar goes.** A swipe or dual map with a 3D Tile layer on one side showed
  "Loading..." for ever: the other side hides the layer, and a hidden 3D Tile layer never
  traversed its tileset, so it never said it was loaded. A hidden one now does.
- **kepler.gl 3.3.0-alpha.25.** Video export writes WebM in the browser (mediabunny, MPL-2.0),
  at up to 4K, with annotations in the picture; Light & Shadow gets shadow map resolution presets
  (Auto, the default, draws as before); the globe keeps its labels, rulers and point sizes while it
  turns, and the Donut layer hides rings on its far side.
- **kepler.gl 3.3.0-alpha.24.** Light & Shadow turned on after the map has loaded casts its
  shadows; before, a map saved with the effect off showed none until it was reloaded with it on.
- **kepler.gl 3.3.0-alpha.23.** Light & Shadow can animate its date and time over a range of its
  own, and a map under its shadows answers the pointer (kepler now binds the shadow sampler in
  picking, as Plus already did). The Bitmap layer takes an elevation offset; zoom to layer works
  for Zarr, flow field, WMS sublayers and GeoJSON points; polygon and bitmap editing answer the
  pointer again; the flow field layer gets meshes and a switch for its trails.
- **kepler.gl 3.3.0-alpha.22** (flowmap.gl 9.5, loaders.gl 4.5.5; deck.gl and luma.gl unchanged).
  kepler's time widget is rebuilt: play, steps, speed and the animation mode sit in a row above the
  histogram, which can be resized, colour its bins by a layer's categories and edit its range
  exactly. A drawn polygon or line finishes on the second tap and a map click is no longer held
  300 ms for a double click; a rectangle or circle with no width is not drawn. The flow layer draws
  on the globe. Several fixes reach a refreshed panel: a dataset of one row gets a range filter, a
  table's sort and a timestamp's unit follow new rows, numeric categories sort as numbers. The
  bundle keeps apache-arrow's own module order: kepler now imports one of its classes directly, and
  without that every panel stopped on "Cannot access … before initialization".
- **No URL with its credentials in the console.** A warning about a gazetteer, a picture, a data
  link or an action that failed named the URL as typed, and an action's failed request was logged
  whole, its URL and headers with it. A URL is now named by its origin and path only, without a
  user, a password, a query or a fragment, and a failure by its name and message.
- **Gaussian splats change colour with the angle they are seen from.** The spherical harmonics past
  degree 0 that a splat carries, up to degree 3, were read and dropped: each splat had one colour
  from every side, losing the shine and tint the scan was trained with. They are now drawn, the
  harmonics read from SPZ and from glTF's plain attributes, summed in the vertex shader along the
  direction from the eye, in the splats' own space. A scan whose harmonics would take more than
  256 MB of GPU memory keeps one colour a splat. The splat layer's `viewDependentColor` (on by
  default) turns them off.
- **SPZ of version 4.** The version Niantic's library and PlayCanvas's splat-transform write today,
  not gzipped but a header in the clear and each attribute in a zstd stream of its own, was
  refused; it is now read (zstd inflated by fzstd, MIT, 4 KB gzipped), in a glTF's SPZ as in a
  loose file.

## 1.10.1 (2026-11-16)

- **The opacity of a tileset of splats.** A 3D Tile layer of Gaussian splats under an opacity of 1
  looked the same as at 1: each splat's alpha was multiplied by it, and a surface of splats is
  dozens of them deep. Its tiles are now drawn together into a picture of their own, with the depth
  of the nearest splats, and that picture is laid on the map at the layer's opacity, so the whole
  scan is seen through, the same where tiles meet, and what stands in front of it still hides it.

## 1.10.0 (2026-11-16)

- **Gaussian splats in 3D tiles.** A 3D Tile layer given a tileset of Gaussian splats (glTF tiles
  with `KHR_gaussian_splatting`, compressed with SPZ, as ArcGIS's Gaussian splat layers and Cesium's
  tilers serve them) drew nothing: loaders.gl knows neither extension, and the tiles require both.
  The panel now reads them and draws each splat as the ellipse it covers on the screen, fading from
  its centre, back to front, so that they blend into a photographic surface. One level of detail at
  a time, a coarse tile kept until all its finer tiles in view have loaded; large scans sorted in a
  Web Worker; spherical harmonics past the first are not drawn; splats cannot be hovered. See
  [Gaussian splats](https://docs.ubica.dev/layers/url-configured#gaussian-splats).
- **ArcGIS 3D Tiles.** kepler read every address with `arcgis` in it as an I3S scene layer, so an
  ArcGIS `3DTilesServer` tileset drew nothing ("tileset load error"). One that ends in
  `tileset.json` or names a `3DTilesServer` is read as 3D Tiles.
- **Sit on the ground, for tilesets boxed along the Earth's axes.** A root box written along ECEF's
  axes was taken for an upright one, and ArcGIS's, hundreds of metres loose, lifted a site by the
  sea some 950 m over the camera: nothing in it loaded. Such a box no longer grounds a tileset, and
  a tileset of splats is grounded by its splats.
- **Maximum zoom.** A new panel option (Map section), 22 by default, from 16 to 24: deck.gl alone
  stopped the camera at zoom 20, some 150 m from what it looks at. At 24 and full tilt the camera
  stands at about eye height. See
  [Map settings](https://docs.ubica.dev/guide/kepler/map-settings#how-close-you-can-zoom).
- **A nautical chart.** _Base map_ → _Seamap (Open Waters)_ draws OpenStreetMap's seamarks, rebuilt
  every week (buoys, beacons, lights with their characteristics and sectors, hazards, traffic
  separation schemes, ferry routes), over Open Waters' Seascape bathymetry: shaded depths, depth
  areas, contours and soundings. No key, no account, CC BY 4.0; not for navigation. _Map Layers_ gets
  two switches for it, **Seamarks** (which can go on top of the data, as labels can) and **Depths**;
  kepler's label switch would have taken the buoys and lights with the street names. On a hardened
  Grafana it needs `tiles.openwaters.io` and `tiles.versatiles.org` in `connect-src`. See
  [Seamap](https://docs.ubica.dev/guide/map/basemaps-and-relief#seamap).
- **Every source of a base map is credited.** kepler stopped collecting a style's attributions at
  the first source that had one, so a style with some sources credited in the document and others in
  their TileJSON showed only the first: on Seamap, OpenStreetMap without Open Waters. The panel now
  collects them until the map has loaded every source.
- **Points of interest on Shortbread styles.** The _Points of interest_ switch also finds the `pois`
  layer of Shortbread styles (VersaTiles, Seamap's land), not only OpenMapTiles' `poi`.

- **Rasters lie on the relief.** On _Satellite + relief_, _Topographic + relief_ or any base map with
  terrain, a raster was a flat sheet at the height of the centre of the view, cutting through hills
  and floating over valleys. It now lies on the ground. XYZ tiles, Zarr tiles, a COG the tile server
  paints, an ArcGIS Image Service and a WMS that answers no click are handed to the base map, which
  lays them on its terrain as it lays its own imagery, with coarser tiles far off under a tilted
  camera (OpenTopoMap over Chimborazo, tilted 60°: 93 tile requests, where 1.9.0 asked 187 flat); they
  then lie under every other layer, whatever their place in kepler's list. kepler's Raster Tile and
  Image layers, and a WMS that answers clicks, are drawn as before on a grid lifted to the ground. A
  Zarr timeline keeps the previous picture until the next has arrived, as on a flat map. Off the
  relief, nothing changes. See
  [Rasters on the relief](https://docs.ubica.dev/guide/map/basemaps-and-relief#rasters-on-the-relief).
- **A5 cells are A5 1.0's in every layer.** kepler.gl 3.3.0-alpha.21 drew its A5 layer with a5-js
  1.0, whose cell ids differ from 0.x's for the same cell, while the Cells layer placed its points
  and deck.gl drew them with a5-js 0.10.1. The panel now asks for a5-js 1.0 and holds every copy of
  the build to it, so the Cells layer, kepler's A5 layer and DuckDB's a5 extension (built for DuckDB
  1.5.6 and later) read and write the same ids. A5 1.0 also places points about four times faster:
  the Cells layer's A5 places about 130,000 a second, where it placed about 34,000. An id written by
  A5 0.x (DuckDB's a5 extension for DuckDB 1.5.4 and earlier) lands elsewhere on the map;
  `a5_migrate` renumbers it.
- **Each query sets its own Trip layer shape and gazetteer.** Trip layer and Place names were panel
  options, one value for every query, so a map could not fold one trajectory query into paths and
  keep another's rows, or look one query's codes up among airports and another's among countries.
  They are now under **Field mapping → Drawing each query**, shown for the queries that need them (a
  trajectory, names to place), and saved in `queryOptions` by `refId`. A panel saved with either
  keeps drawing as it did: on load its value moves to the `*` entry, which every query without its
  own takes. A Geomap converted to Kepler keeps each of its layers' gazetteers, on the query the
  layer reads, where only the first was kept.
- **A raster query can choose its own colour ramp, bands and painting**, as a Zarr query already
  chose its ramp and range: `raster_colormap`, `raster_bands` and `raster_painted` columns win over
  the Raster colour ramp, Raster bands and Let the tile server paint options. A land cover the
  server paints can lie under imagery the browser colours with a ramp; `'$bands' AS raster_bands`
  lets a dropdown pick one query's bands.
- **Flow line style is gone.** It styled only the flow layers the panel adds to a map not saved yet;
  a saved map's flow layers kept their own style and the option did nothing, while it still showed
  the style it named. Each flow layer's **Line Style** (and **Curviness**) is in kepler's layer
  panel, and a saved map keeps it. A panel saved with the option drops it on load.

## 1.9.0 (2026-11-13)

- **kepler.gl 3.3.0-alpha.21**, from 3.3.0-alpha.20, with **deck.gl 9.4** and luma.gl 9.4 under it.
  A new **Donut** layer: a ring at each point split into the shares of up to six numeric columns
  (trips by mode, votes by party), near points grouped as you zoom out with their columns summed.
  The Contour layer gains a **3D surface** and an outline colour of its own; the heatmap's 3D
  surface pans more smoothly; a tileset can show its bounds; a camera tour shows its stops on the
  map, where they can be dragged; and fixes to filters on vector tiles, 3D tiles, unambiguous
  day-first dates, GeoJSON imports and very detailed polygons. The Cells layer's A5 cells are the same
  cells, placed about three times faster.
- **Publish drawn line.** A line drawn with the draw tool's Line goes to a dashboard variable as
  `LINESTRING` WKT, as a drawn area does: the most recent once it rests, emptied when deleted,
  nothing written on load. For the other panels' queries along it: a vertical section through a 3D
  grid under it (`ST_LineLocatePoint`), a profile, the rows near the line. Cross-filtering → Publish
  drawn line.
- **The photos layer loads its pictures as the symbol layer does.** It handed each row's address
  straight to deck, which fetched whatever it was given, of any scheme, with no limit on how many,
  and through `connect-src`, which a strict Content-Security-Policy keeps to Grafana's own host. It
  now asks only for `https:`, `http:` (on a Grafana served over `http:`) and `data:image/`
  addresses, by `<img>` as the symbol layer does, and draws at most 96 different pictures. The rows
  beyond them, and those whose picture could not load, draw their frame alone. Its panel names each
  picture that could not load, and why, under **Picture column**. The frames load the same way.
- **A picture on Grafana's own address is fetched without the viewer's session**, in the photos and
  the symbol layer alike. An address in a query's rows can no longer act for the viewer (`/logout`,
  or an `/api/` route that answers a GET). Grafana's static files, under `/public/`, still load as
  any image on the page does.

## 1.8.0 (2026-11-12)

- **A Cells layer: points counted in H3, A5, S2 or geohash cells whose level follows the zoom.** The
  hexagon layer bins points in hexagons of a fixed radius in kilometres, the same at every zoom, and
  the H3, A5, S2 and geohash layers draw cells the data already carries, at one level. **Cells**
  gives every point its cell in the browser and draws the level whose cells are about **Cell size**
  pixels across, so the map refines as you zoom in. It keeps the hexagon layer's aggregations,
  colour and height channels, legend, popup and filters; its colours are those of the cells around
  the view, so the legend is the view's. **Per km²** divides each cell by its area; **Transition**
  eases cells to their new colour when the level changes, the new ones coming out of their parent's
  colour; **Log** and **Sqrt** join its colour scales.
- **A column named like a count keeps its name unless the query is an origin–destination one.** A
  column called `trips`, `weight`, `flow`, `total` or `volume` reached kepler as `count` on every
  query, though only the flow layer reads a count by that name. A layer coloured, sized or animated by
  such a column under its own name, a pipe's `flow` on Kepler Plus's Pipeline, found no column of that
  name and dropped the channel without a word, and the column was missing from kepler's field lists
  under its name. Only an origin–destination query (both ends by latitude and longitude, or by H3
  cell) now renames its count. A map saved before, whose layers, filters or tooltips name `count` on
  such a query, keeps it named `count`, so it draws as it did.

## 1.7.0 (2026-11-09)

- **Export Map writes JSON only.** kepler's HTML export, the dialog's default, is a page that loads
  React, Redux and styled-components from esm.sh, kepler.gl from unpkg.com and fonts from
  CloudFront wherever it is opened, and the dialog fetched three preview pictures for it from
  kepler's documentation bucket on CloudFront as it opened, even with JSON chosen. The dialog is now
  kepler's own without its HTML part, with JSON as its one format, and fetches nothing.
- **kepler's Raster Tile form no longer sends COGs to titiler.xyz.** *Add Data → Tileset → Raster
  Tile* asked Development Seed's public server, `https://titiler.xyz`, about every Cloud Optimized
  GeoTIFF typed into it (its URL, signature included) about 300 ms after it was typed, and saved
  that server as the tileset's, whatever the panel's *Raster tile server* said. The form's *Raster
  tile servers* field now starts from the panel's option; a COG is described by the first server in
  it (`<server>/cog/stac`) and drawn by those servers; with none, the form asks no one and says a
  COG needs a server. The build fails if a kepler release changes the form so that this no longer
  holds.
- **Saving the map leaves tileset access tokens out.** The token typed into *Add Data → Tileset →
  3D Tile* (a Cesium ion or Google key) was saved with the tileset into the dashboard's JSON, where
  every viewer could read it. The save, and a configuration pasted into *Import configuration*, now
  leave out the fields kepler's own *Export map* leaves out unless asked to include layer API keys;
  the token lasts for the session. A dashboard saved with one still loads with it, and its next save
  drops it.
- **Breaking: the *CARTO API key* option is gone.** A panel option is saved in the dashboard's JSON,
  where everyone who can view the dashboard can read it, so the panel no longer takes a key: Dark
  Matter, Positron and Voyager are asked of CARTO without one, as when the option was empty (their
  vector styles and tiles draw; CARTO's raster tiles carry a watermark without a key). A panel saved
  with a key opens without it and its next save leaves the key out. To use a key of your own, serve
  a copy of CARTO's style that carries it and choose *Base map → Self-hosted style.json*.
- **Live data.** A query that streams through Grafana Live — the built-in datasource's *Live
  measurements* fed by `/api/live/push`, the MQTT datasource, any streaming datasource — now keeps
  the map on its newest rows: the trip playhead goes to the last instant with every update, and a time
  window not driven by the dashboard range slides along, until you move either away from the end.
  The map takes at most one update per *Live update interval* (1 s by default, under the new *Live
  data* options): on Helsinki's public transport over MQTT, which updates the panel five times a second, that cut
  the browser's busy time about fifteen-fold. A series that arrives with labels (line protocol
  tags) is read as a row per series, with each label as a column, where the map used to draw the
  first series alone. See *Live data* in the guide.
- **Saving the map keeps the layers still waiting for their data.** A save made before every query
  had answered, or before a click had picked the scene a raster layer shows, left those layers out,
  with their filters, their side of a split map and their tooltip fields, and the next load drew
  without them (or with kepler's own default layers). They are now saved as they were loaded.
- **Grafana annotations on the map.** The dashboard's annotations that carry a place — a
  `geo:<lng>,<lat>` tag, or a callout saved in their data — are drawn as notes on the map while their
  time is in the map's window. A new option under *Map*, *Grafana annotations*, turns this off, or to
  **Show and save**: a note made on the map with right-click → *Add Annotation* is then saved as a
  Grafana annotation over the map's window, which every time chart of the dashboard draws, and
  editing, restyling or deleting it on the map changes the annotation. The time charts draw it at
  their next refresh. Saving needs the viewer's own annotation permissions. See *Annotations* in the
  guide.
- **kepler's annotation list.** The **Aa** button opens the list of the map's notes, with their kind
  (text, point, arrow, circle, ruler), line, colour and text placement, duplicate and delete. A click
  on the bare map, or Escape, puts down the note being edited.
- **kepler.gl 3.3.0-alpha.20**, from 3.3.0-alpha.17 (by way of alpha.19): the annotation list and
  ruler, camera bookmarks and tours, timeline charts for numeric filters; new **Contour** and
  **Voronoi** layers, a 3D density surface for the heatmap, glow and pulse effects on points, a
  rotation per icon; and many fixes to filters, exports, Arrow data, rasters, Trip and vector tile
  layers. A saved tooltip compare mode and the layers on every world copy are now kepler's own
  (fixes sent upstream from this plugin, as was the zoom fade that a replaced dataset lost), so the
  panel's workarounds for them are gone. A query's new answer is drawn once its rows are built: until
  then the map keeps the previous rows, filters included, where it used to drop them for a moment.
- On a map with no saved configuration, a query's GeoJSON layer now starts coloured by one of its
  decimal columns, as kepler 3.3.0-alpha.19 colours the GeoJSON layers it builds.
- **kepler's own Zarr layer**, which reads a store in the browser, is on: *Add Data → Tileset → Zarr*.
  Fine for a small store that sends CORS headers; a large one is far faster through the panel's own
  layer. See *Zarr stores* in the guide for the comparison.
- kepler's A5 layer is named **A5** in the layer list, where it showed `Layer.Type.A5`.
- **Breaking: the panel's Zarr layer is now `zarrTiles`** (*Zarr (TiTiler)* in the layer list),
  because kepler's new layer took the type `zarr`. A saved map whose layer on a
  `grafana-<refId>-zarr` dataset still says `"type": "zarr"` must say `"type": "zarrTiles"`.
- **Data links on the map.** Grafana's data links, set under **Data links and actions** as on any
  other panel, show in the popup of a clicked entity, filled from the row that was clicked. A link
  marked **One click** is followed on the click itself, unless the click selects the entity for the
  dashboard's variables; then it waits in the popup.
- **Ad hoc filters from the map.** A new option under *Cross-filtering*, *Ad hoc filters from the
  popup*, names columns whose value the popup of a clicked entity adds to the dashboard's ad hoc
  filters, for (`=`) or out (`!=`), as Grafana's table does from a cell. Offered only when the
  dashboard has an ad hoc filters variable for the panel's data source; Chaski applies them, the
  DuckDB server plugin and Infinity do not. See *Data links and actions* in the guide.
- **Actions on the map.** Grafana's actions show as buttons in the same popup, for the people who can
  edit the dashboard (as on Grafana's own panels; viewers and anonymous visitors see none). They ask
  for the values they declare, ask for confirmation, then send their request.
- The panel editor no longer lists unit, colour scheme, thresholds and the other field options the
  map never used.
- **Draw a query as a route.** A new option under *Map*, *Draw as a route*, joins a query's rows
  in the order it returns them into one line: a dataset of its own, “… · route”, with one segment
  per pair of rows, drawn as a Line layer that can be coloured and sized by any column. On a map
  without a saved configuration the layer appears by itself.
- **From Geomap in one click.** "Change visualization" from a Geomap panel to Kepler keeps its
  markers, heatmap, route, network, photos, GeoJSON, XYZ / Esri tile and night / day layers (colour
  and size by field, thresholds and colour schemes, labels, route arrows, GeoJSON style rules), the
  columns it was told, its view, its layer
  order and its base map, with the legend on when Geomap showed one. Like Geomap, the converted map
  draws every row its queries return, without coupling its clock to the dashboard. What has no
  counterpart yet is named in a notice right after the switch. Layers placed by geohash or by place
  name come across too.
- **Places by geohash or by name.** A query without coordinates is placed by a `geohash` column
  (decoded to its cell's centre) or by a column of place names and codes (*Place name* in *Field
  mapping*), looked up in Grafana's countries, US states or airports, or a file of your own (*Map →
  Place names*). Rows with an unknown place stay in the table and are not drawn.
- **Photos.** A new layer type draws the picture at each point from a column of image addresses,
  in a square or round frame of the layer's colour. Built on the point layer, so filters, tooltips
  and clicks work as on points. A wide picture is not cropped to its frame.
- **XYZ tiles.** A new layer type draws any `{z}/{x}/{y}` raster tile server (OpenStreetMap-style
  servers, ArcGIS MapServer caches, radar overlays), saved with the map as its template. Geomap's
  XYZ and Esri layers become one, and so does a tiled Geomap base map the panel has no style for.
- **Night shading.** A new option under *Map* shades the side of the Earth in darkness at the end
  or the start of the dashboard time range, with the sun's position if wanted. It moves with the
  range.
- **Networks on the map.** A query of edges with `source` and `target` columns is drawn as lines
  between the nodes of another query that has an `id` and coordinates, Grafana's node graph shape:
  each edge takes the positions of its two nodes and keeps its own columns for colour and width.
- **Files added by URL stay on the map.** A GeoJSON, CSV or other file loaded through kepler's
  *Add Data* by URL is saved with the map as its address and fetched again on load, like a
  tileset. A file Grafana serves itself keeps a path relative to Grafana, so the dashboard works on
  any instance.
- **Geohash queries drawn as cells.** A query placed by geohash alone, with no saved map, gets one
  GeoHash layer, the panel's, instead of kepler's GeoHash (new in 3.3.0-alpha.19) and a Point layer
  of dots on the cell centres, one above the other. A geohash column chosen in *Field mapping* under
  another name draws its cells too. A map converted from Geomap keeps its markers at the centres.
- **Layers on every world copy** (#57). Past ±180° the base map repeats and the layers now repeat
  with it: zoomed out, every copy of the world has its points, and over the antimeridian (Fiji,
  Tonga, the Aleutians) the far side keeps them. Map notes stay on the copy in view, and a note
  made or a coordinate pinned on a copy is saved at its place within ±180°.

## 1.6.2 (2026-10-27)

- **Base maps on Grafana Cloud.** OpenFreeMap, CARTO and the other base maps stayed black there
  and only the data layers drew. They now load as on a Grafana of your own.

## 1.6.1 (2026-10-27)

- **A click on a map with many rows is no longer lost.** On a heavy map a click on a point could
  publish nothing and open no popup, while the hover tooltip kept working.

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
