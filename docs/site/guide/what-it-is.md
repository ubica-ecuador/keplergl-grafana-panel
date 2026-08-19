# What it is

A Grafana panel plugin that runs [kepler.gl](https://kepler.gl) inside the panel, fed by any
Grafana data source. It is built for spatio-temporal data — points, trajectories,
origin–destination flows, velocity fields — and it configures itself from the columns your query
already returns.

`kepler.gl` is the geospatial visualisation library Uber open-sourced and Foursquare now
maintains. It renders with [deck.gl](https://deck.gl) on WebGL, which is what lets it draw
hundreds of thousands of features and animate them.

## What runs where

The whole library runs **in the panel**, in your browser, against the rows your data source
returned. There is no iframe, no hosted service, no account, and no call to any vendor: the plugin
even ships kepler's own icon library so that nothing is fetched from a CDN at runtime.

That matters for three kinds of install. An **air-gapped** Grafana can serve its own `style.json`
and never reach the internet. A Grafana with `content_security_policy = true` needs a handful of
`connect-src` hosts for the base map tiles and nothing else — see [Install](./install#hardened-grafana).
And an organisation that cannot send its coordinates to a third party does not have to.

## What it is not

- **Not a data source.** It draws what a query returns; it does not fetch anything itself.
- **Not a reimplementation of kepler.gl.** It embeds the real library. Every layer setting, colour
  palette, filter and interaction you find in kepler's own documentation is present in the panel.
  See [Differences from stock kepler.gl](../reference/differences-from-kepler) for the small
  number of places where the panel departs from it.
- **Not a reprojection engine.** It renders WGS84 (EPSG:4326) longitude/latitude only. A source
  that hands you projected metres must be asked for WGS84 — see
  [Infinity → WFS](./sources/infinity).

## How it compares to Geomap

Grafana ships a built-in **Geomap** panel, and for a lot of jobs it is the right answer: it is
signed, in every install, and light. Reach for this panel instead when you need something Geomap
does not do.

|                          | Geomap        | This panel                                            |
| ------------------------ | ------------- | ----------------------------------------------------- |
| Rendering                | OpenLayers    | deck.gl on WebGL                                      |
| Trajectory animation     | —             | Automatic Trip layer with a playback timeline         |
| Origin–destination flows | —             | Automatic animated flow layers                        |
| Velocity fields          | —             | Streamlines traced from a grid, re-traced as you zoom |
| Aggregation              | Heatmap       | Heatmap, grid, hexbin, cluster, H3, S2                |
| Geometry input           | GeoJSON       | GeoJSON, WKT, raw WKB/EWKB                            |
| Layer styling            | Panel options | kepler's full layer panel, saved with the dashboard   |
| 3D                       | —             | Extrusion, tilt, and base maps with real elevation    |
| In the catalog           | Built in      | Not yet — see [Install](./install)                    |

Geomap is the lighter tool and it is already there. This one is what you want when the data is
moving, when there is a lot of it, or when the styling has to go further than a panel option list.

## How it compares to the Foursquare Studio panel

Foursquare publishes its own Grafana panel, which renders its map in an iframe against
`studio.foursquare.com` and therefore needs a Foursquare account. This plugin exists as the open
alternative to it. If you are coming from there, start at
[Migrating from the Foursquare panel](./migrating-from-the-foursquare-panel) — it maps their
column conventions onto ours and covers bringing a saved map configuration across.

## Status

Version 0.3, and pinned to a kepler.gl pre-release because the Flow layer exists nowhere else.
Usable, and not yet in the Grafana catalog — so it installs unsigned. See
[Compatibility](../reference/compatibility) for the supported Grafana versions and what is planned
for 1.0.
