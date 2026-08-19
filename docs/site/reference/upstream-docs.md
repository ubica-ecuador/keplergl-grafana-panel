# Upstream documentation

Half of what you see in the panel is kepler.gl's UI, and everything it draws is deck.gl. Neither is
re-documented here — theirs is maintained, and a copy would go stale on every version bump. This
page is the link hub, with the versions each link was written against.

## The pinned versions

| Library        | Version bundled          |
| -------------- | ------------------------ |
| kepler.gl      | **3.3.0-alpha.7**        |
| deck.gl        | **9.3.10**               |
| MapLibre GL JS | **4** (pinned by kepler) |
| React          | 18.3.1                   |

::: warning Upstream documents an older kepler than this plugin ships
kepler.gl's public documentation describes the **3.2 stable line**. The plugin pins a 3.3.0
pre-release, because the **Flow layer** — which the origin–destination support is built on — exists
nowhere in 3.2.

So upstream lists fifteen layer types where the bundled version registers nineteen, and a few
attributes present in the UI have no upstream entry. Where that matters, it is called out on the
page that sends you there.
:::

## kepler.gl

| Topic                                          | Link                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Getting started                                | [j-get-started](https://docs.kepler.gl/docs/user-guides/j-get-started)               |
| The workflow — adding, hiding, blending layers | [b-kepler-gl-workflow](https://docs.kepler.gl/docs/user-guides/b-kepler-gl-workflow) |
| Layer types                                    | [c-types-of-layers](https://docs.kepler.gl/docs/user-guides/c-types-of-layers)       |
| Layer attributes                               | [d-layer-attributes](https://docs.kepler.gl/docs/user-guides/d-layer-attributes)     |
| Colour palettes                                | [l-color-attributes](https://docs.kepler.gl/docs/user-guides/l-color-attributes)     |
| Filters                                        | [e-filters](https://docs.kepler.gl/docs/user-guides/e-filters)                       |
| Map styles                                     | [f-map-styles](https://docs.kepler.gl/docs/user-guides/f-map-styles)                 |
| Interactions                                   | [g-interactions](https://docs.kepler.gl/docs/user-guides/g-interactions)             |
| Map settings                                   | [m-map-settings](https://docs.kepler.gl/docs/user-guides/m-map-settings)             |
| Time playback                                  | [h-playback](https://docs.kepler.gl/docs/user-guides/h-playback)                     |
| Save and export                                | [k-save-and-export](https://docs.kepler.gl/docs/user-guides/k-save-and-export)       |
| FAQ                                            | [i-FAQ](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/i-FAQ.md) |

Three features are documented only in the repository, not on the docs site:

| Topic                           | Link                                                                                                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effects                         | [effects.md](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/effects.md)                                                                                                                                                                     |
| Draw on map                     | [draw-on-map.md](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/draw-on-map.md)                                                                                                                                                             |
| SQL data explorer, AI assistant | [sql-data-explorer.md](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/sql-data-explorer.md), [ai-assistant.md](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/ai-assistant.md) — **neither is included in this plugin** |

## deck.gl

You never write deck.gl props here — kepler does that. Its documentation is still worth reaching for
when you want to know why a layer behaves as it does.

| Topic              | Link                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Layer catalogue    | [api-reference/layers](https://deck.gl/docs/api-reference/layers)                             |
| Using layers       | [developer-guide/using-layers](https://deck.gl/docs/developer-guide/using-layers)             |
| Performance        | [developer-guide/performance](https://deck.gl/docs/developer-guide/performance)               |
| Coordinate systems | [developer-guide/coordinate-systems](https://deck.gl/docs/developer-guide/coordinate-systems) |
| FAQ                | [Frequently asked questions](https://deck.gl/docs/faq)                                        |

Which deck.gl layer backs which kepler layer is in [Under the hood](./under-the-hood).

## MapLibre

The base map, and everything about it — styles, sprites, glyphs, tiles, terrain — is MapLibre's.
Relevant here mostly when you self-host a `style.json`.

| Topic               | Link                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| Style specification | [maplibre.org/maplibre-style-spec](https://maplibre.org/maplibre-style-spec/) |
| Terrain             | [terrain](https://maplibre.org/maplibre-style-spec/terrain/)                  |

## Grafana

| Topic                   | Link                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| Variables               | [Grafana variables](https://grafana.com/docs/grafana/latest/dashboards/variables/)                |
| Data links              | [Data links](https://grafana.com/docs/grafana/latest/panels-visualizations/configure-data-links/) |
| Provisioning dashboards | [Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)              |
| Content Security Policy | [Configuration](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/)         |

## What we document instead

To be explicit about the seam:

**Ours** — how a Grafana query becomes a map, field-role detection, the layers the panel builds
itself, everything about dashboard integration, the panel options, and deployment concerns like
version floors and CSP.

**Theirs** — layer types and attributes, colour, filters, interactions, map settings, playback,
export.

**Ours, and only ours** — [the deltas](./differences-from-kepler): where this panel departs from
stock kepler.
