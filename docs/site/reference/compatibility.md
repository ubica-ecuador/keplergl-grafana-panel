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

### Grafana Cloud

Not yet. Unsigned plugins cannot be installed on Grafana Cloud, and the plugin is unsigned until
1.0. See below.

## Signing and the catalog

The plugin is **unsigned** while it is pre-1.0, so it needs to be allowed explicitly:

```ini
[plugins]
allow_loading_unsigned_plugins = ubica-keplergl-panel
```

Signing and catalog submission are what **v1.0** is, together with moving from the kepler.gl 3.3.0
pre-release to the stable release when it lands.

## Bundled libraries

| Library        | Version                  |
| -------------- | ------------------------ |
| kepler.gl      | **3.3.0-alpha.7**        |
| deck.gl        | **9.3.10**               |
| MapLibre GL JS | **4** (pinned by kepler) |
| React          | 18.3.1                   |

### Why a kepler pre-release

The **Flow layer** — the whole of the origin–destination support — exists nowhere in the 3.2 stable
line. Pinning the pre-release is what makes that feature possible, and it is the single reason the
plugin has not gone to 1.0.

The practical consequence for you is that kepler's public documentation describes a version older
than the one you are running: it lists fifteen layer types where the bundled build registers
nineteen. See [Upstream documentation](./upstream-docs).

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
base map tile hosts need `connect-src` entries — and only those; your data never leaves Grafana. See
[Install](../guide/install#hardened-grafana).

An **air-gapped** install works with **Base map → Self-hosted style.json**, or with _No Basemap_.
kepler's icon library and the effect thumbnails are vendored with the plugin, so nothing is fetched
from any CDN at runtime.

## Roadmap

| Version | Status                                                                         |
| ------- | ------------------------------------------------------------------------------ |
| 0.2     | done — automatic trip layers, dashboard time range coupling                    |
| 0.3     | done — origin–destination flow layers, map filters driving dashboard variables |
| **1.0** | kepler.gl 3.3.0 stable, signed, submitted to the Grafana catalog               |
