# Layer gallery

Every layer type the panel can build from query rows, with the query that produces it. Thirteen of
kepler's nineteen registered layer types can be driven by data; the other six take a URL instead and
are covered on [Layers a query cannot drive](./url-configured).

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

Four of the thirteen are built for you when the columns are right. The rest you add by hand in
kepler's layer panel, choosing the dataset and pointing the layer's columns at it.

| Built automatically | Trigger                                     |
| ------------------- | ------------------------------------------- |
| point               | a latitude/longitude pair                   |
| geojson             | a geometry column                           |
| hexagonId (H3)      | a column whose values are valid H3 indices  |
| trip                | a trip id **and** a time **and** a position |
| flow                | origin and destination columns              |

See [How a query becomes a map](../guide/data/how-a-query-becomes-a-map).

## About these images

They come from the plugin's own **layer gallery dashboard**, `provisioning/dashboards/layers.json`,
which is provisioned into the dev Grafana and shows all thirteen on synthetic data around Cuenca,
Ecuador. Bring it up with `npm run server` and open _Kepler.gl layer gallery_.

They are captured by `npm run docs:shots`, one panel at a time through Grafana's single-panel view —
thirteen maps on one page would exceed the browser's WebGL context budget and black out the oldest.
kepler's side panel and playback widget are hidden for the shot; they overlay the map rather than
sitting beside it, so hiding them reveals the map underneath.

::: tip The gallery is a regression test
A layer type that stops rendering after a kepler.gl version bump is visible immediately as a blank
map in a page you scroll. That is the reason it exists, and the reason it is worth keeping current.
:::
