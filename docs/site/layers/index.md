# Layer gallery

Every layer type the panel can build from query rows, with the query that produces it. Thirteen of
kepler's twenty-two registered layer types can be driven by data — and the panel registers layer
types of its own, shown with amber icons in kepler's layer menu: among them
[Streamlines](../guide/data/velocity-fields) and a [vector field](../guide/data/velocity-fields#arrows-and-wind-barbs)
for a grid of velocities, [Symbols](../guide/data/symbols) for anything with a bearing,
[Markers](../guide/map/markers) for points you drag, and a
[Zarr tileset](../guide/data/zarr) for a store of arrays.

Two of kepler's own, `a5` and `geohash`, are grid-index layers like H3 and S2 but are not detected
from a column; they can still be added by hand. See
[Layers configured with a URL](./url-configured#using-them-anyway).

Many of these are easier to judge moving than in a still: they are drawing right now on the
**[live demo dashboards](https://grafana.ubica.ec/dashboards)**, which anyone can open as a read-only
viewer.

Of the six that take a URL instead, two can now be driven by one as well — a query that returns a
link to imagery draws a `rasterTile` layer, and one that names a service draws a `wms` layer. See
[Rasters](../guide/data/rasters) and [WMS services](../guide/data/wms). The remaining four, and
adding any of them by hand, are on [Layers configured with a URL](./url-configured).

<div class="gallery">
  <a href="./points-and-aggregation.html#point"><img src="/img/layer-point.jpg" alt="Point layer"><span>point</span></a>
  <a href="./points-and-aggregation.html#heatmap"><img src="/img/layer-heatmap.jpg" alt="Heatmap layer"><span>heatmap</span></a>
  <a href="./points-and-aggregation.html#grid"><img src="/img/layer-grid.jpg" alt="Grid layer"><span>grid</span></a>
  <a href="./points-and-aggregation.html#hexagon"><img src="/img/layer-hexagon.jpg" alt="Hexagon layer"><span>hexagon</span></a>
  <a href="./points-and-aggregation.html#cluster"><img src="/img/layer-cluster.jpg" alt="Cluster layer"><span>cluster</span></a>
  <a href="./points-and-aggregation.html#icon"><img src="/img/layer-icon.jpg" alt="Icon layer"><span>icon</span></a>
  <a href="./geometry-and-indices.html#geojson"><img src="/img/layer-geojson.jpg" alt="GeoJSON layer"><span>geojson</span></a>
  <a href="./geometry-and-indices.html#h3"><img src="/img/layer-h3.jpg" alt="H3 hexagon layer"><span>hexagonId (H3)</span></a>
  <a href="./geometry-and-indices.html#s2"><img src="/img/layer-s2.jpg" alt="S2 layer"><span>s2</span></a>
  <a href="./origin-destination.html#arc"><img src="/img/layer-arc.jpg" alt="Arc layer"><span>arc</span></a>
  <a href="./origin-destination.html#line"><img src="/img/layer-line.jpg" alt="Line layer"><span>line</span></a>
  <a href="./origin-destination.html#flow"><img src="/img/layer-flow.jpg" alt="Flow layer"><span>flow</span></a>
  <a href="./time.html#trip"><img src="/img/layer-trip.jpg" alt="Trip layer"><span>trip</span></a>
  <a href="./symbols-and-markers.html#symbol"><img src="/img/layer-symbol.jpg" alt="Symbols layer"><span>symbol</span></a>
  <a href="./symbols-and-markers.html#markers"><img src="/img/layer-markers.jpg" alt="Markers layer"><span>markers</span></a>
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
| trip                | a trip id **and** a time **and** a position                |
| flow                | origin and destination columns                             |
| flowfield           | a position **and** a velocity, **and no trip id** — a layer type this plugin adds, named **Streamlines**. kepler's own Flow Field would be created for the same grid, and is removed. See [Velocity fields](../guide/data/velocity-fields). |
| vectorfield         | never guessed — switch a Streamlines layer's type, or add it from **Add Layer**. Arrows and wind barbs over the same grid. See [Velocity fields](../guide/data/velocity-fields#arrows-and-wind-barbs). |
| symbol              | a position **and** a numeric bearing, **and no trip id** — a layer type this plugin adds, named **Symbols**. The Point layer kepler would guess from the same coordinates is removed. See [Symbols](../guide/data/symbols). |
| markers             | never guessed — add it from **Add Layer**. Draggable reference points bound to dashboard variables; it draws nothing from its dataset. See [Markers](../guide/map/markers). |

See [How a query becomes a map](../guide/data/how-a-query-becomes-a-map).

## About these images

Thirteen of them come from the plugin's own **layer gallery dashboard**,
`provisioning/dashboards/layers.json`, which is provisioned into the dev Grafana and shows them on
synthetic data around Cuenca, Ecuador. Bring it up with `npm run server` and open _Kepler.gl layer
gallery_. The two the panel adds that the gallery does not carry — `symbol` and `markers` — are
photographed on their own provisioned dashboards, `symbols.json` and `markers.json`.

They are captured by `npm run docs:shots`, one panel at a time through Grafana's single-panel view —
a dozen maps on one page would exceed the browser's WebGL context budget and black out the oldest.
kepler's side panel and playback widget are hidden for the shot; they overlay the map rather than
sitting beside it, so hiding them reveals the map underneath.

::: tip The gallery is a regression test
A layer type that stops rendering after a kepler.gl version bump is visible immediately as a blank
map in a page you scroll. That is the reason it exists, and the reason it is worth keeping current.
:::
