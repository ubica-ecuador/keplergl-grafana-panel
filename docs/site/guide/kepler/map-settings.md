# Map settings

kepler's map controls sit at the top right of the map: 3D, split view, legend, layer visibility, and
— added by this plugin — effects. They work as documented upstream; what changes in a dashboard is
the space you have to spend on them.

## A panel is not a full window

kepler was designed for a browser tab. A dashboard tile is often 400 pixels tall, and several of
these controls assume more room than that.

The panel's answer is **Show side panel**, which hides kepler's layer and filter panel entirely.
Worth turning off on a small tile: the map becomes a map, and you configure it by temporarily
enlarging the panel or editing it. The saved configuration keeps the styling either way.

## 3D

Tilts the camera. Needed for extruded polygons, for stacked velocity-field levels, and for the two
relief base maps — see [Base maps and relief](../map/basemaps-and-relief).

Two things to expect on a tilted map:

- **Your data does not drape over the relief.** deck.gl draws at its own altitude. This is a deck.gl
  property, covered in [Under the hood](../../reference/under-the-hood).
- **Panning a tilted terrain map can make the camera jitter**, because kepler pins MapLibre 4
  ([keplergl/kepler.gl#3394](https://github.com/keplergl/kepler.gl/issues/3394)).

## Globe

kepler's globe projection works, and looks striking on a large panel. Two practical caveats in a
dashboard: it wants a lot of pixels to be legible at all, and the viewport-publishing channel
describes a rectangle in degrees, which is a poor description of what a globe is showing.

## Legend

Shows the colour and size encodings for the visible layers. It is part of the saved configuration,
so a provisioned dashboard can open with it already on.

On a small tile it covers a meaningful share of the map. A stat panel or a text panel beside the map
is often a better legend than the legend.

## Split maps

Two synchronised views of the same data with different layers visible in each. Genuinely useful for
before/after comparisons, and expensive: a split map is **two sets of WebGL contexts**, which brings
the budget below into play sooner.

## The WebGL context budget

::: warning Maps go black when there are too many
Each map holds **two** WebGL contexts — MapLibre's and deck.gl's — and browsers cap the total at
around **sixteen**. Past that the browser evicts the oldest and those maps go black, with
`Too many active WebGL contexts` in the console.

So roughly **eight maps** per page, fewer with split views.
:::

The mitigation is Grafana's own: put maps in **collapsed rows**. Grafana does not render panels
inside a collapsed row, and collapsing one releases its contexts. The plugin's layer gallery
dashboard is built this way for exactly this reason — thirteen maps, five collapsible rows, two open
at a time.

If a dashboard genuinely needs many maps visible at once, the answer is usually fewer, larger maps
with more layers each.

---

**Upstream:** [Map settings](https://docs.kepler.gl/docs/user-guides/m-map-settings) ·
[Map styles](https://docs.kepler.gl/docs/user-guides/f-map-styles)

Written against **kepler.gl 3.3.0-alpha.7**. See
[Upstream documentation](../../reference/upstream-docs).
