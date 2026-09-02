# Compatibility

## Grafana

```
>=12.0.10 <12.1 || >=12.1.7 <12.2 || >=12.2.5
```

Three windows rather than a single floor, because the requirement was fixed in a patch on each of
three release lines.

**Why:** Grafana only added `react/jsx-runtime` to its frontend module import map in those patches.
Below them the plugin does not degrade — it fails to load. A 12.0.5 install will reject it even
though it is nominally "Grafana 12".

There is **no backend component**, so there is nothing to match against your Grafana's architecture
or operating system beyond the browser.

### Grafana 13 and React 19

The range has no upper bound, so **13.x installs this plugin** — and 13 is where Grafana moved from
React 18 to React 19. That is tested, not assumed: the full end-to-end suite runs against a
provisioned Grafana **13.2.1** bench (`grafana-13` in `docker-compose.yaml`, port 3003) and passes
**48/48**.

`@grafana/react-detect` does report the plugin as incompatible. Every one of its findings sits in a
package inside kepler's dependency tree — `react-color`, `react-virtualized`, `react-modal`,
`react-json-pretty`, `@kepler.gl/components`, `preact` — and none in this plugin's own code. In
practice they are false positives: React 19 ignores `propTypes` rather than failing on them, and
preact is not React. The one finding that is a real behavioural change is react-color's
`defaultProps` on function components; kepler's colour picker opens and throws nothing on 13.2.1,
though a default going silently missing would not throw, so treat that one as evidence rather than
proof.

### Grafana Cloud

A signed community plugin is installable on Grafana Cloud once it is published there. This plugin
is submitted and awaiting review, so a Cloud install is not available yet. See below.

## Signing and the catalog

The plugin is **submitted** to the
[Grafana plugin catalog](https://grafana.com/grafana/plugins/ubica-keplergl-panel/) and is awaiting
review — it is not signed yet. Once accepted it installs like any other catalog plugin, with no
`allow_loading_unsigned_plugins` entry needed. See [Install](../guide/install) for both the intended
catalog flow and the release-archive install that works while the review is pending.

## Bundled libraries

| Library        | Version                  |
| -------------- | ------------------------ |
| kepler.gl      | **3.3.0-alpha.9**        |
| deck.gl        | **9.3.10**               |
| MapLibre GL JS | **4** (pinned by kepler) |
| React          | 18.3.1                   |

### Why a kepler pre-release

The **Flow layer** — the whole of the origin–destination support — exists nowhere in the 3.2 stable
line. Pinning the pre-release is what makes that feature possible. There is still no stable 3.3.0
release to move to, so the pin stays exact rather than a caret range.

The practical consequence for you is that kepler's public documentation describes a version older
than the one you are running: it lists fifteen layer types where the bundled build registers
twenty-one. See [Upstream documentation](./upstream-docs).

## Browser and hardware

**WebGL 2** is required. Everything the map draws goes through deck.gl, and there is no canvas or
SVG fallback.

Practically that means a current Chrome, Firefox, Edge or Safari on a machine with working graphics
acceleration. Software rendering works — the plugin's own end-to-end tests run under SwiftShader —
but it is slow enough that it is not a deployment strategy.

::: warning The WebGL context budget
Each map holds **two** contexts, MapLibre's and deck.gl's, against a browser cap near sixteen. That
is roughly **eight maps per page**, fewer with split views. Past it, the browser evicts the oldest
and those maps go black.

Collapsed Grafana rows are the mitigation: a collapsed row renders nothing and releases its
contexts. See [Map settings](../guide/kepler/map-settings).
:::

## Data sources

Any data source that returns a table works — the panel reads data frames, not a specific protocol.
The ones with documented recipes are PostGIS, DuckDB and Infinity; see
[Data source recipes](../guide/sources/postgis).

Two are worth a compatibility note of their own:

| Data source  | Note                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **DuckDB**   | glibc only — will not run on an Alpine-based Grafana image. Outside the catalog, so installed from a release zip, unsigned. |
| **Infinity** | In the catalog and signed. Its CSV parser types every column as string; set lat/lng columns to Number.                      |

## Coordinate reference systems

**EPSG:4326 only.** The panel renders WGS84 longitude/latitude degrees and does not reproject.
Project in the query, or ask the server for 4326.

## Network

With a default Grafana CSP, nothing needs configuring. With `content_security_policy = true`, the
base map tile hosts need `connect-src` entries — and, if a query draws imagery, so does the tile
server, archive host or WMS behind it. Your rows never leave Grafana either way. See
[Install](../guide/install#hardened-grafana).

An **air-gapped** install works with **Base map → Self-hosted style.json**, or with _No Basemap_.
kepler's icon library and the effect thumbnails are vendored with the plugin, so nothing is fetched
from any CDN at runtime.

Imagery is compatible with that, but not by default: the **Raster tile server** option starts at a
public service, and has to be repointed at one of your own — or sidestepped entirely with a
[`.pmtiles` archive](../guide/data/rasters#pmtiles), which needs no server at all, only somewhere
static to be served from.

## Releases

| Version   | Shipped                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2       | automatic trip layers, dashboard time range coupling                                                                                   |
| 0.3       | origin–destination flow layers, map filters driving dashboard variables                                                                |
| **1.0**   | cloud-native imagery on the dashboard clock (COG, PMTiles, Zarr, WMS, ArcGIS Image Services), animated velocity fields as a layer, and the five cross-filtering channels |

The full history is in the
[changelog](https://github.com/ubica-ecuador/keplergl-grafana-panel/blob/main/CHANGELOG.md).
