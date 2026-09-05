---
# The first Introduction entry in the sidebar is the outbound link to the live
# demos, and VitePress builds the pager from that same list — without this, the
# first page of the docs proper offers a "previous page" that walks out of the
# site. It had no previous page before the demo link existed either.
prev: false
---

# What it is

A Grafana panel plugin that runs [kepler.gl](https://kepler.gl) inside the panel, fed by any
Grafana data source. It is built for spatio-temporal data — points, trajectories,
origin–destination flows, velocity fields — and it configures itself from the columns your query
already returns.

`kepler.gl` is the geospatial visualisation library Uber open-sourced and Foursquare now
maintains. It renders with [deck.gl](https://deck.gl) on WebGL, which is what lets it draw
hundreds of thousands of features and animate them.

<video src="/img/guide-accessibility-dashboard.mp4" poster="/img/guide-accessibility-dashboard.jpg" autoplay loop muted playsinline controls aria-label="The panel in a dashboard: clicking the map moves the origin, dragging the time window resizes the transit accessibility isochrone over Cuenca, and the stats and charts beside it follow" style="width:100%;height:auto;border-radius:8px"></video>

::: tip See it running before you install anything
The dashboards built with this panel are live at
**[grafana.ubica.ec](https://grafana.ubica.ec/dashboards)** — trajectories, wind fields, satellite
imagery on a clock, polygons out of a database, tables that re-rank as you pan. Anonymous visitors
are let in as read-only viewers, so you can pan, filter and play them with no account and nothing
installed.
:::

## What runs where

The whole library runs **in the panel**, in your browser, against the rows your data source
returned. There is no iframe and no hosted service rendering the map: the browser draws it directly.
It does still reach outward for pixels — Carto, Esri and Mapterhorn for the default base maps, and
`https://titiler.xyz` by default for raster tiles — see [Install → Hardened
Grafana](./install#hardened-grafana) for the exact hosts and how to point every one of them at
infrastructure of your own instead. kepler's own icon library ships with the plugin, so that piece
at least is never fetched from a CDN at runtime.

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
| In the catalog           | Built in      | Submitted, awaiting review — see [Install](./install) |

Geomap is the lighter tool and it is already there. This one is what you want when the data is
moving, when there is a lot of it, or when the styling has to go further than a panel option list.

## How it compares to the Foursquare Studio panel

Foursquare publishes its own Grafana panel, which renders its map in an iframe against
`studio.foursquare.com` and therefore needs a Foursquare account. This plugin exists as the open
alternative to it. If you are coming from there, start at
[Migrating from the Foursquare panel](./migrating-from-the-foursquare-panel) — it maps their
column conventions onto ours and covers bringing a saved map configuration across.

## Status

Version 1.0, submitted to the Grafana plugin catalog and awaiting review, and pinned to a kepler.gl
pre-release because the Flow layer exists nowhere else. See
[Compatibility](../reference/compatibility) for the supported Grafana versions and the catalog and
signing status.
