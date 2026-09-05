# Kepler Geospatial Maps for Grafana

![The Amazon basin drawn as a velocity field: every tributary traced by streamlines over a dark basemap](https://raw.githubusercontent.com/ubica-ecuador/keplergl-grafana-panel/main/src/img/banner.png)

Interactive [kepler.gl](https://kepler.gl) maps inside Grafana dashboards, fed by any Grafana data
source. Built for advanced spatio-temporal mobility data — points, trajectories and origin-destination flows visualizations.

An open source alternative to the Foursquare Studio panel, which renders its map in an iframe against
`studio.foursquare.com` and therefore needs a Foursquare account. This one runs kepler.gl inside the
panel: no account, no Mapbox token, no hosted service rendering your map.

**🌍 [Live demos](https://grafana.ubica.ec/dashboards)** — dashboards running in a public Grafana. No account and nothing to install: open one and pan, filter and play it yourself.

**📖 [Full documentation](https://ubica-ecuador.github.io/keplergl-grafana-panel/)** — guides,
tutorials, a layer gallery and a complete option reference.

> **Status: v1.0.** The first release submitted to the Grafana plugin catalog. Pinned to a kepler.gl
> pre-release because the Flow layer exists nowhere else — see [Compatibility](https://ubica-ecuador.github.io/keplergl-grafana-panel/reference/compatibility.html).

## What it does today

- **Any data source.** Each query becomes a kepler dataset, so a single panel can overlay several.
- **Column autodetection**, overridable per query — lat/lng, time, trip id, geometry, H3 and
  origin/destination pairs.
- **Geometry from any spatial source** — GeoJSON, WKT, or raw WKB/EWKB hex, so a plain
  `SELECT geom` from PostGIS works with no `ST_AsGeoJSON`.
- **Automatic trip animation** — a query with a trip id and a time becomes an animated kepler Trip
  layer with a playback timeline, no manual layer setup.
- **Origin-destination flow layers**, automatic — an OD query becomes an animated flow map.
- **Animated wind and current fields** — a grid of velocities becomes a Flow field layer that traces
  streamlines through it, following the view so its density and line length hold steady as you zoom.
  Density, trail, cycle and smoothing are set on the layer itself. Several levels can be stacked in
  one map.
- **Dashboard time range synced with the map** — one-way, both ways, or published to variables so
  the map keeps its whole dataset while the slider drives the other panels.
- **Cross-filtering, both ways** — a filter set on the map drives a dashboard variable, and changing
  that variable filters the map. Clicks, the viewport and drawn areas publish too.
- **Your layer configuration survives a refresh.** Data is swapped underneath the layers rather than
  the datasets being torn down and rebuilt.
- **Saved map configuration** stored with the dashboard, and configs pasted from kepler.gl,
  Foursquare Studio or Dekart are accepted.
- **Follows the dashboard theme**, base map included.
- **No account needed for any base map.** Carto's three, and Esri's three — flat satellite imagery,
  plus satellite and topographic with **real elevation**: tilt the camera and the ground has relief.
  Topographic exists only in this relief form; there is no flat version. Every one can be swapped for
  a self-hosted `style.json`; kepler's icon library ships with the plugin.

> **Esri's terms of use.** The satellite and topographic imagery come from Esri's public
> `services.arcgisonline.com` endpoint, whose terms ask for an ArcGIS account for production use.
> Installs that need a cleaner footing should point **Base map** at their own `style.json`.

## Dashboards built with it

Every picture is the panel drawing rows a query returned — and every one of them is
**[live at grafana.ubica.ec](https://grafana.ubica.ec/dashboards)**, read-only, so the screenshots
below can be checked against the running thing.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/ubica-ecuador/keplergl-grafana-panel/main/docs/site/public/img/showcase/zarr-stats.jpg" alt="Zarr, drawn and measured" width="100%">
      <p><b>Zarr, drawn and measured</b><br>
      <sub>A Zarr store rendered live, and the rectangle you draw measured in the month the layer is showing.</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/ubica-ecuador/keplergl-grafana-panel/main/docs/site/public/img/showcase/chirps-rain.jpg" alt="Daily rainfall, and its clock" width="100%">
      <p><b>Daily rainfall, and its clock</b><br>
      <sub>One cloud-optimised GeoTIFF per day. The time bar changes the picture without re-running the query.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/ubica-ecuador/keplergl-grafana-panel/main/docs/site/public/img/showcase/earthquakes.jpg" alt="Seismicity in three dimensions" width="100%">
      <p><b>Seismicity in three dimensions</b><br>
      <sub>Magnitude as height and colour, kepler's own layer panel open, a click publishing its coordinate.</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/ubica-ecuador/keplergl-grafana-panel/main/docs/site/public/img/showcase/fires.jpg" alt="Active fires, ranked as you pan" width="100%">
      <p><b>Active fires, ranked as you pan</b><br>
      <sub>Hotspots on a 0.1° grid, with the table beside it ranking whatever is in view.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/ubica-ecuador/keplergl-grafana-panel/main/docs/site/public/img/showcase/water-risk.jpg" alt="Polygons straight from the database" width="100%">
      <p><b>Polygons straight from the database</b><br>
      <sub>WRI Aqueduct basins as GeoJSON, coloured by score over a satellite base map.</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/ubica-ecuador/keplergl-grafana-panel/main/docs/site/public/img/showcase/severe-weather.jpg" alt="Reports, filtered both ways" width="100%">
      <p><b>Reports, filtered both ways</b><br>
      <sub>NOAA storm reports by type. The variables filter the map, and the map filters the counts.</sub></p>
    </td>
  </tr>
</table>

**[Open the live demos →](https://grafana.ubica.ec/dashboards)** — these six and a dozen more, from
Zarr, COG, STAC and PMTiles imagery to wind fields and transit isochrones. How each one was built is in the
[documentation](https://ubica-ecuador.github.io/keplergl-grafana-panel/).

## Installing

Requires **Grafana `>=12.0.10 <12.1 || >=12.1.7 <12.2 || >=12.2.5`**. Those floors are not arbitrary:
Grafana only added `react/jsx-runtime` to its module import map in those patches, and the plugin
fails to load below them.

Install it from the Grafana plugin catalog, from the command line:

```bash
grafana cli plugins install ubica-keplergl-panel
```

or from **Administration → Plugins** inside Grafana. Then restart Grafana.

**Installing while the catalog review is pending.** The plugin is submitted but not yet listed, so
the command above and the in-app installer will both report "plugin not found." Until the listing
goes live, download the release archive from
[GitHub Releases](https://github.com/ubica-ecuador/keplergl-grafana-panel/releases) instead, unpack
it into Grafana's plugin directory as a `ubica-keplergl-panel` folder, and allow it explicitly since
it is unsigned until the review signs it:

```ini
[plugins]
allow_loading_unsigned_plugins = ubica-keplergl-panel
```

Then restart Grafana. That setting stops being necessary once the catalog listing is live. Full
instructions, including Docker and a hardened Grafana, are in the
[install guide](https://ubica-ecuador.github.io/keplergl-grafana-panel/guide/install.html).

### Hardened Grafana

With `content_security_policy = true` the map loads and its Web Workers start, but `connect-src`
blocks the base map. MapLibre fetches styles, sprites, glyphs and tiles over XHR, so they all fall
under that directive:

```ini
content_security_policy_template = """...connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://services.arcgisonline.com https://tiles.mapterhorn.com https://titiler.xyz ...;"""
```

Each host serves only what its name suggests: Carto the three default base maps, Esri the satellite
and topographic ones, Mapterhorn the elevation tiles behind the two relief styles, and `titiler.xyz`
the default raster tile server, described next. Leave out the ones you never use — or point
**Base map** and **Raster tile server** at infrastructure of your own and skip this entirely.

> **The raster tile server.** A query that returns imagery — a COG, a Zarr store, a WMS — is drawn
> by a tile server, not by the browser. The **Raster tile server** option starts at
> `https://titiler.xyz`, Development Seed's public demo, so that a fresh install draws a public COG
> without being configured first. It reads the imagery on the map's behalf, which means the URL you
> point it at is handed to a third party, and it cannot see anything private. Point the option at a
> TiTiler of your own for anything that matters, and add that host to `connect-src` instead. A
> `.pmtiles` archive needs no server at all.

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

Layer and map styling lives in kepler's store, so capture it with
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

Three of those benches sit at **12.0.10**, the floor of the supported range, which is what catches
accidental use of a newer API. A fourth covers the other end — `docker compose up --build grafana-13`
runs **Grafana 13** on `:3003`, where React 18 becomes React 19, and the suite is expected to pass
there too:

```bash
GRAFANA_URL=http://localhost:3003 npx playwright test --workers=1
```

To publish a bench rather than run one locally, copy `docker-compose.override.example.yml` to
`docker-compose.override.yml` and edit it. Compose picks that name up automatically; it is
gitignored because it names an external network and a public hostname, so it must not reach anyone
else's checkout.

The documentation site lives in `docs/site` as its own npm package:

```bash
npm --prefix docs/site install
npm run docs:dev
```

The [contributing guide](https://ubica-ecuador.github.io/keplergl-grafana-panel/contributing.html)
covers the three benches, the provisioned dashboards, the browser verification scripts and how the
documentation screenshots are regenerated.

## Licence

Apache-2.0. The published archive bundles third-party code and assets — kepler.gl and deck.gl (MIT),
flowmap.gl (Apache-2.0), and kepler.gl's icon and colormap assets. Their notices are in
[THIRD-PARTY-LICENSES.md](https://github.com/ubica-ecuador/keplergl-grafana-panel/blob/main/THIRD-PARTY-LICENSES.md),
which ships inside the plugin as well.
