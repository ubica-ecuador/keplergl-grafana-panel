# Layer gallery

Every layer type the panel can build from query rows, with the query that produces it. Eighteen of
kepler's twenty-five registered layer types can be driven by data — and the panel registers layer
types of its own, shown with amber icons in kepler's layer menu: among them
[Streamlines](../guide/data/velocity-fields) and a [vector field](../guide/data/velocity-fields#arrows-and-wind-barbs)
for a grid of velocities, [Symbols](../guide/data/symbols) for anything with a bearing,
[Markers](../guide/map/markers) for points you drag, a
[Zarr tileset](../guide/data/zarr) for a store of arrays, [Photos](./points-and-aggregation#photos) for a picture at each point,
and [XYZ tiles](./url-configured#xyz-tiles) for a `{z}/{x}/{y}` tile server.

Two of kepler's own, [`a5` and `geohash`](./geometry-and-indices#geohash), are grid-index layers
like H3 and S2, detected from a column's name. A third, kepler's
[Flow Field](./velocity-fields#kepler-flow-field), draws streamlines through scattered velocities
where the panel's Streamlines need a grid.

Many of these are easier to judge moving than in a still: they are drawing right now on the
**[live demo dashboards](https://pacha.ubica.dev/)**, which anyone can open as a read-only
viewer.

Of the seven that take a URL instead, two can now be driven by one as well — a query that returns a
link to imagery draws a `rasterTile` layer, and one that names a service draws a `wms` layer. See
[Rasters](../guide/data/rasters) and [WMS services](../guide/data/wms). The rest — vector tiles, 3D
tiles, a bitmap, 3D models and kepler's own Zarr layer — and adding any of them by hand, are on
[Layers configured with a URL](./url-configured).

<div class="gallery">
  <a href="./points-and-aggregation.html#point"><img src="/img/layer-point.jpg" alt="Point layer"><span>point</span></a>
  <a href="./points-and-aggregation.html#heatmap"><img src="/img/layer-heatmap.jpg" alt="Heatmap layer"><span>heatmap</span></a>
  <a href="./points-and-aggregation.html#grid"><img src="/img/layer-grid.jpg" alt="Grid layer"><span>grid</span></a>
  <a href="./points-and-aggregation.html#hexagon"><img src="/img/layer-hexagon.jpg" alt="Hexagon layer"><span>hexagon</span></a>
  <a href="./points-and-aggregation.html#cells"><img src="/img/layer-cells.jpg" alt="Cells layer"><span>cells</span></a>
  <a href="./points-and-aggregation.html#contour"><img src="/img/layer-contour.jpg" alt="Contour layer"><span>contour</span></a>
  <a href="./points-and-aggregation.html#cluster"><img src="/img/layer-cluster.jpg" alt="Cluster layer"><span>cluster</span></a>
  <a href="./points-and-aggregation.html#voronoi"><img src="/img/layer-voronoi.jpg" alt="Voronoi layer"><span>voronoi</span></a>
  <a href="./points-and-aggregation.html#icon"><img src="/img/layer-icon.jpg" alt="Icon layer"><span>icon</span></a>
  <a href="./geometry-and-indices.html#geojson"><img src="/img/layer-geojson.jpg" alt="GeoJSON layer"><span>geojson</span></a>
  <a href="./geometry-and-indices.html#h3"><img src="/img/layer-h3.jpg" alt="H3 hexagon layer"><span>hexagonId (H3)</span></a>
  <a href="./geometry-and-indices.html#s2"><img src="/img/layer-s2.jpg" alt="S2 layer"><span>s2</span></a>
  <a href="./geometry-and-indices.html#geohash"><img src="/img/layer-geohash.jpg" alt="GeoHash layer"><span>geohash</span></a>
  <a href="./geometry-and-indices.html#a5"><img src="/img/layer-a5.jpg" alt="A5 layer"><span>a5</span></a>
  <a href="./origin-destination.html#arc"><img src="/img/layer-arc.jpg" alt="Arc layer"><span>arc</span></a>
  <a href="./origin-destination.html#line"><img src="/img/layer-line.jpg" alt="Line layer"><span>line</span></a>
  <a href="./origin-destination.html#flow"><img src="/img/layer-flow.jpg" alt="Flow layer"><span>flow</span></a>
  <a href="./time.html#trip"><img src="/img/layer-trip.jpg" alt="Trip layer"><span>trip</span></a>
  <a href="./velocity-fields.html#kepler-flow-field"><img src="/img/layer-kepler-flow-field.jpg" alt="kepler's Flow Field layer"><span>flowField</span></a>
  <a href="./symbols-and-markers.html#symbol"><img src="/img/layer-symbol.jpg" alt="Symbols layer"><span>symbol</span></a>
  <a href="./symbols-and-markers.html#markers"><img src="/img/layer-markers.jpg" alt="Markers layer"><span>markers</span></a>
  <a href="./url-configured.html#vectortile"><img src="/img/layer-vector-tile.jpg" alt="Vector tile layer"><span>vectorTile</span></a>
  <a href="./url-configured.html#tile3d"><img src="/img/layer-tile3d.jpg" alt="3D tile layer"><span>tile3d</span></a>
  <a href="./url-configured.html#bitmap"><img src="/img/layer-bitmap.jpg" alt="Bitmap layer"><span>bitmap</span></a>
  <a href="./url-configured.html#model"><img src="/img/layer-3d-model.jpg" alt="3D model layer"><span>3D</span></a>
</div>

<style scoped>
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
  margin: 24px 0;
}
.gallery a {
  display: block;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  text-decoration: none;
  transition: border-color 0.2s;
}
.gallery a:hover { border-color: var(--vp-c-brand-1); }
.gallery img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
.gallery span {
  display: block;
  padding: 7px 10px;
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
}
</style>

## Which ones you get without asking

Some are built for you when the columns are right. The rest you add by hand in kepler's layer panel,
choosing the dataset and pointing the layer's columns at it.

| Built automatically | Trigger                                                    |
| ------------------- | ---------------------------------------------------------- |
| point               | a latitude/longitude pair                                  |
| geojson             | a geometry column                                          |
| hexagonId (H3)      | a column whose values are valid H3 indices                 |
| geohash             | a column named `geohash`, `geo_hash` or `geohash_id`. A `geohash` column also gives a Point layer at the cells' centres. See [geohash](./geometry-and-indices#geohash). |
| a5                  | a column named `a5`, `a5_token` or `a5_id`, holding hexadecimal cell ids. See [a5](./geometry-and-indices#a5). |
| trip                | a trip id **and** a time **and** a position                |
| flow                | origin and destination columns                             |
| flowfield           | a position **and** a velocity, **and no trip id** — a layer type this plugin adds, named **Streamlines**. kepler's own Flow Field would be created for the same grid, and is removed. See [Velocity fields](../guide/data/velocity-fields). |
| flowField           | columns named exactly `u` and `v` beside a position, when the rows are **not** a regular grid — kepler's own **Flow Field**, which the panel leaves in place. See [Velocity fields](./velocity-fields#kepler-flow-field). |
| vectorfield         | never guessed — switch a Streamlines layer's type, or add it from **Add Layer**. Arrows and wind barbs over the same grid. See [Velocity fields](../guide/data/velocity-fields#arrows-and-wind-barbs). |
| symbol              | a position **and** a numeric bearing, **and no trip id** — a layer type this plugin adds, named **Symbols**. The Point layer kepler would guess from the same coordinates is removed. See [Symbols](../guide/data/symbols). |
| markers             | never guessed — add it from **Add Layer**. Draggable reference points bound to dashboard variables; it draws nothing from its dataset. See [Markers](../guide/map/markers). |
| line                | a query chosen in **Draw as a route**, or edges with `source` and `target` beside a query of nodes. See [Routes and networks](../guide/data/routes-and-networks). |
| cells               | never guessed — add it from **Add Layer** on a dataset with coordinates. Points counted in H3, A5, S2 or geohash cells at a level that follows the zoom. See [cells](./points-and-aggregation#cells). |
| photos              | never guessed — add it from **Add Layer** on a dataset with coordinates and a column of picture addresses, and pick that column in its panel. A converted Geomap Photos layer is one. See [photos](./points-and-aggregation#photos). |

See [How a query becomes a map](../guide/data/how-a-query-becomes-a-map).

## About these images

Fifteen of them come from the plugin's own **layer gallery dashboard**,
`provisioning/dashboards/layers.json`, which is provisioned into the dev Grafana and shows them on
synthetic data around Cuenca, Ecuador. Bring it up with `npm run server` and open _Kepler.gl layer
gallery_. The two the panel adds that the gallery does not carry — `symbol` and `markers` — are
photographed on their own provisioned dashboards, `symbols.json` and `markers.json`. The seven kepler
layers after them — `geohash`, `a5`, `flowField`, `vectorTile`, `tile3d`, `bitmap` and `3D` — were
photographed the same way on a test Grafana, from dashboards that are not provisioned, so
`npm run docs:shots` does not retake them.

They are captured by `npm run docs:shots`, one panel at a time through Grafana's single-panel view —
a dozen maps on one page would exceed the browser's WebGL context budget and black out the oldest.
kepler's side panel and playback widget are hidden for the shot; they overlay the map rather than
sitting beside it, so hiding them reveals the map underneath.

::: tip The gallery is a regression test
A layer type that stops rendering after a kepler.gl version bump is visible immediately as a blank
map in a page you scroll. That is the reason it exists, and the reason it is worth keeping current.
:::
