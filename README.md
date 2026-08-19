# Kepler Geospatial Maps

Interactive [kepler.gl](https://kepler.gl) maps inside Grafana dashboards, fed by any Grafana data
source. Built for spatio-temporal mobility data — points, trajectories and origin-destination flows.

An open source alternative to the Foursquare Studio panel, which renders its map in an iframe against
`studio.foursquare.com` and therefore needs a Foursquare account. This one runs kepler.gl inside the
panel: no external service, no account, no Mapbox token.

**📖 [Full documentation](https://ubica-ecuador.github.io/keplergl-grafana-panel/)** — guides,
tutorials, a layer gallery and a complete option reference.

> **Status: v0.3.** Usable, and pinned to a kepler.gl pre-release because the Flow layer exists
> nowhere else. Not yet in the Grafana catalog — see [Roadmap](#roadmap).

## What it does today

- **Any data source.** Each query becomes a kepler dataset, so a single panel can overlay several.
- **Column autodetection**, overridable per query — lat/lng, time, trip id, geometry, H3 and
  origin/destination pairs.
- **Geometry from any spatial source** — GeoJSON, WKT, or raw WKB/EWKB hex, so a plain
  `SELECT geom` from PostGIS works with no `ST_AsGeoJSON`.
- **Automatic trip animation** — a query with a trip id and a time becomes an animated kepler Trip
  layer with a playback timeline, no manual layer setup.
- **Origin-destination flow layers**, automatic — an OD query becomes an animated flow map.
- **Animated wind and current fields** — a grid of velocities becomes a field of streamlines that
  follows the view, keeping its density and line length steady as you zoom. Several levels can be
  stacked in one map.
- **Dashboard time range synced with the map** — one-way, both ways, or published to variables so
  the map keeps its whole dataset while the slider drives the other panels.
- **Cross-filtering, both ways** — a filter set on the map drives a dashboard variable, and changing
  that variable filters the map. Clicks, the viewport and drawn areas publish too.
- **Your layer configuration survives a refresh.** Data is swapped underneath the layers rather than
  the datasets being torn down and rebuilt.
- **Saved map configuration** stored with the dashboard, and configs pasted from kepler.gl,
  Foursquare Studio or Dekart are accepted.
- **Follows the dashboard theme**, base map included.
- **No account needed for any base map.** Carto's three, Esri's satellite and topographic ones, and
  two of those with **real elevation** — tilt the camera and the ground has relief. Every one can be
  swapped for a self-hosted `style.json`; kepler's icon library ships with the plugin. The base maps
  that require a Mapbox account are not offered at all, rather than sitting in the picker blanking
  the map when clicked.

> **Esri's terms of use.** The satellite and topographic imagery come from Esri's public
> `services.arcgisonline.com` endpoint, whose terms ask for an ArcGIS account for production use.
> Installs that need a cleaner footing should point **Base map** at their own `style.json`.

## Installing

Requires **Grafana `>=12.0.10 <12.1 || >=12.1.7 <12.2 || >=12.2.5`**. Those floors are not arbitrary:
Grafana only added `react/jsx-runtime` to its module import map in those patches, and the plugin
fails to load below them.

The plugin is unsigned while it is pre-1.0, so allow it explicitly:

```ini
[plugins]
allow_loading_unsigned_plugins = ubica-keplergl-panel
```

Then restart Grafana. Full instructions, including Docker and a hardened Grafana, are in the
[install guide](https://ubica-ecuador.github.io/keplergl-grafana-panel/guide/install.html).

### Hardened Grafana

With `content_security_policy = true` the map loads and its Web Workers start, but `connect-src`
blocks the base map. MapLibre fetches styles, sprites, glyphs and tiles over XHR, so they all fall
under that directive:

```ini
content_security_policy_template = """...connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://services.arcgisonline.com https://tiles.mapterhorn.com ...;"""
```

Each host serves only what its name suggests: Carto the three default base maps, Esri the satellite
and topographic ones, Mapterhorn the elevation tiles behind the two relief styles. Leave out the ones
whose base maps you never select — or point **Base map** at a `style.json` on your own network and
skip this entirely.

## A first map

Nothing special is required of a query: the plugin reads the columns it already returns.

```sql
SELECT lat AS latitude,
       lon AS longitude,
       recorded_at,          -- any time column is detected by type
       speed_kmh             -- extra columns become tooltips and colour scales
FROM gps_readings;
```

Add a panel, choose **Kepler Geospatial Maps**, and that is a map. Name a column the plugin does not
recognise and you map it by hand under **Field mapping**, per query.

Two things worth knowing immediately: kepler's default point radius is small, so raise it before
concluding nothing rendered; and layer styling lives in kepler's store, so capture it with
**Map configuration → Save current map** before reloading the page.

The [quickstart](https://ubica-ecuador.github.io/keplergl-grafana-panel/guide/quickstart.html) walks
through it properly, and
[tutorial 1](https://ubica-ecuador.github.io/keplergl-grafana-panel/tutorials/first-map.html) builds a
live map of global seismicity from a public feed.

## Documentation

| Section                                                                                                                    | Covers                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Getting data in](https://ubica-ecuador.github.io/keplergl-grafana-panel/guide/data/how-a-query-becomes-a-map.html)        | How a query becomes a map, points, geometry, trajectories, flows, H3 and S2, velocity fields |
| [The map](https://ubica-ecuador.github.io/keplergl-grafana-panel/guide/map/basemaps-and-relief.html)                       | Base maps and relief, theme, saving and importing a configuration                            |
| [Using kepler's own panel](https://ubica-ecuador.github.io/keplergl-grafana-panel/guide/kepler/layers-and-attributes.html) | Layers, colour, filters, interactions, playback, effects — and what differs here             |
| [Dashboard integration](https://ubica-ecuador.github.io/keplergl-grafana-panel/guide/dashboard/time-range-sync.html)       | Time sync, cross-filtering, publishing the viewport and drawn areas                          |
| [Data source recipes](https://ubica-ecuador.github.io/keplergl-grafana-panel/guide/sources/postgis.html)                   | PostGIS, DuckDB, Infinity, and any other SQL source                                          |
| [Layer gallery](https://ubica-ecuador.github.io/keplergl-grafana-panel/layers/)                                            | Every layer type the panel can build, with the query behind it                               |
| [Tutorials](https://ubica-ecuador.github.io/keplergl-grafana-panel/tutorials/)                                             | Six end-to-end walkthroughs against public data                                              |
| [Reference](https://ubica-ecuador.github.io/keplergl-grafana-panel/reference/panel-options.html)                           | Panel options, field roles, variable formats, troubleshooting, compatibility                 |

Two pages are worth singling out.
[Differences from stock kepler.gl](https://ubica-ecuador.github.io/keplergl-grafana-panel/reference/differences-from-kepler.html)
lists everything this panel changes about kepler, and
[Under the hood](https://ubica-ecuador.github.io/keplergl-grafana-panel/reference/under-the-hood.html)
maps each kepler layer to the deck.gl layer that actually draws it.

## Development

```bash
npm install
npm run dev             # watch build
npm run server          # Grafana 12.0.10 on :3000, plus a strict-CSP one on :3001
npm run server:sources  # a bench on :3002 with DuckDB and Infinity installed
npm run test:ci         # unit tests
npm run e2e             # end-to-end against the running Grafana
```

Requires Node 22+. `dist/` is bind-mounted into the containers, so do **not** `rm -rf dist` while
they are running — that leaves them serving a stale inode. `npm run build` cleans it correctly.

The documentation site lives in `docs/site` as its own npm package:

```bash
npm --prefix docs/site install
npm run docs:dev
```

The [contributing guide](https://ubica-ecuador.github.io/keplergl-grafana-panel/contributing.html)
covers the three benches, the provisioned dashboards, the browser verification scripts and how the
documentation screenshots are regenerated.

## Roadmap

- **v0.2** _(done)_ — automatic trip layers; dashboard time range synced with kepler's timeline,
  one-way or both ways.
- **v0.3** _(done)_ — origin-destination flow layers; map filters driving dashboard variables.
- **v1.0** — move to kepler.gl 3.3.0 stable, sign, and submit to the Grafana catalog.

## Licence

Apache-2.0. Bundles [kepler.gl](https://github.com/keplergl/kepler.gl) (MIT) and
[flowmap.gl](https://github.com/visgl/flowmap.gl) (Apache-2.0).
