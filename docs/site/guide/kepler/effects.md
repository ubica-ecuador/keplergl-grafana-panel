# Effects

Lighting and post-processing over the whole map: sun position, ambient occlusion, bloom, and
distance and surface fog. The button is in the map control at the top right.

## The button is the plugin's, the feature is kepler's

kepler ships the entire effects feature — the button component, the manager panel, the reducer
state, the deck.gl lighting and post-processing passes. What it does **not** do is put the button in
the toolbar: its stock map control never mounts it, and nothing in the core mounts the manager
panel. Both are wired by the **host application**, which is what kepler's own demo app does.

This plugin is that host, so it replaces kepler's map control with one that adds the effects button
and hosts the manager beside the toolbar. That is the single component the plugin swaps out; the
rest of kepler's UI is untouched. See
[Differences from stock kepler.gl](../../reference/differences-from-kepler).

Two things from the demo app are deliberately _not_ included: the SQL data explorer and the AI
assistant. Neither belongs in a dashboard panel.

## Thumbnails are vendored

The effect picker shows a preview image per effect. kepler names those under whatever asset base the
host configures, and this plugin points that at **its own assets** — so the images ship with the
plugin and are served from Grafana.

Nothing is fetched from a CDN, which is the same rule the rest of the plugin follows: no outbound
call to any vendor, and no `connect-src` entry needed on a hardened Grafana.

## What is worth using in a dashboard

Effects are a rendering cost on every frame, on a page that may hold several maps. Some earn it:

- **Sun / lighting** makes extruded polygons and 3D anything legible — without a light source,
  extrusion reads as flat colour.
- **Ambient occlusion** separates overlapping 3D geometry.
- **Fog** gives a tilted map depth, and quietly hides the horizon artefacts a tilted base map
  produces.

Bloom and the more decorative passes are hard to justify on a dashboard that is refreshing every
thirty seconds and sharing a GPU with seven other panels.

## Effects are saved with the map

**Save current map** captures them along with the layers and filters, so a provisioned dashboard can
open with its lighting already set. See [Map configuration](../map/map-configuration).

---

**Upstream:** kepler documents effects in its repository rather than on the docs site —
[Effects guide](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/effects.md).

Written against **kepler.gl 3.3.0-alpha.7**. See
[Upstream documentation](../../reference/upstream-docs).
