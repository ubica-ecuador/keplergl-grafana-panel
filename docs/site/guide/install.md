# Install

## Requirements

**Grafana `>=12.0.10 <12.1 || >=12.1.7 <12.2 || >=12.2.5`.**

Those floors are not arbitrary and they are not conservatism. Grafana only added
`react/jsx-runtime` to its module import map in exactly those patches; below them the plugin does
not fail gracefully, it fails to load at all. If the panel shows a module error on a 12.0.x
install, the patch level is the first thing to check.

There is no backend component and nothing to install on the server beyond the plugin itself.

## Installing the plugin

The plugin is **submitted** to the
[Grafana plugin catalog](https://grafana.com/grafana/plugins/ubica-keplergl-panel/) and is awaiting
review. Once accepted, install it like any other catalog plugin:

```bash
grafana cli plugins install ubica-keplergl-panel
```

or from **Administration → Plugins** inside Grafana.

1. Restart Grafana.
2. Confirm it loaded under **Administration → Plugins**, and that **Kepler Geospatial Maps** appears
   in the visualisation picker when you edit a panel.

::: tip Installing while the review is pending
Until the catalog listing goes live, `grafana cli plugins install` and the in-app installer will not
find it. Download the release archive from
[GitHub Releases](https://github.com/ubica-ecuador/keplergl-grafana-panel/releases), unpack it into
Grafana's plugin directory — so that you end up with a `ubica-keplergl-panel` folder there; the
default location is `/var/lib/grafana/plugins` on a package install, and `data/plugins` relative to
the working directory otherwise, whatever your `paths.plugins` setting says wins — and allow it
explicitly, since it is unsigned until the review signs it:

```ini
[plugins]
allow_loading_unsigned_plugins = ubica-keplergl-panel
```

That entry becomes unnecessary once the catalog listing is live. `allow_loading_unsigned_plugins`
disables a real check in the meantime, so only list plugins you obtained from a source you trust,
and prefer verifying the archive's checksum against the release page.
:::

### With Docker

```yaml
services:
  grafana:
    image: grafana/grafana:12.0.10
    environment:
      GF_INSTALL_PLUGINS: ubica-keplergl-panel
```

While the review is pending, mount the unpacked release archive instead and set the same allowance
as an environment variable:

```yaml
services:
  grafana:
    image: grafana/grafana:12.0.10
    environment:
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: ubica-keplergl-panel
    volumes:
      - ./ubica-keplergl-panel:/var/lib/grafana/plugins/ubica-keplergl-panel
```

### Grafana Cloud

A signed community plugin is installable on Grafana Cloud once it is published there. This plugin
is awaiting review, so a Cloud install is not available yet.

## Hardened Grafana

With `content_security_policy = true` the map loads and its Web Workers start, but the base map
goes blank: MapLibre fetches styles, sprites, glyphs and tiles over XHR, so every one of them falls
under `connect-src`.

```ini
content_security_policy_template = """… connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://services.arcgisonline.com https://tiles.mapterhorn.com https://titiler.xyz …;"""
```

Each host serves only what its name suggests:

| Host                        | What it serves                                       |
| --------------------------- | ------------------------------------------------------ |
| `basemaps.cartocdn.com`     | Carto's Dark Matter, Positron and Voyager base maps   |
| `services.arcgisonline.com` | Esri's satellite and topographic imagery              |
| `tiles.mapterhorn.com`      | Elevation tiles behind the two relief styles          |
| `titiler.xyz`                | The default **Raster tile server** — see next section |

Leave out the ones whose base maps you never select — or point **Base map** at a `style.json` on
your own network and skip the list entirely. See [Base maps and relief](./map/basemaps-and-relief).

Note that these hosts are for the _base map_. Your own data never leaves Grafana: it arrives
through the data source you already configured, and the panel draws it locally.

### Imagery adds its own hosts

A query that draws [imagery](./data/rasters) points the browser at somewhere new, so it needs an
entry of its own. Which host depends on the path:

| What you draw               | Host that needs the `connect-src` entry                             |
| --------------------------- | ------------------------------------------------------------------- |
| A COG, through a tile server | the **tile server** — it reads the file, so the bucket is never contacted by the browser |
| A `.pmtiles` archive        | wherever the archive is served from                                 |
| A [WMS](./data/wms)         | the service itself                                                  |

::: warning `connect-src`, never `img-src`
Tiles and WMS pictures are fetched and parsed as data rather than pointed at by an `<img>`, so the
directive that looks right is the wrong one. The symptom is a map that draws nothing, silently, with
no CSP message about images.
:::

Imagery is also the one case where the paragraph above wants qualifying. Your rows still never leave
Grafana — but the **address** of a raster does reach whichever tile server you configured, and the
option defaults to a public one. Point it at a server of your own for anything private. See
[Rasters](./data/rasters#something-has-to-read-the-file).

## Esri's terms of use

The satellite and topographic imagery come from Esri's public `services.arcgisonline.com`
endpoint, whose terms ask for an ArcGIS account for production use. An install that needs a
cleaner footing should point **Base map** at its own `style.json`.

## Next

[Quickstart →](./quickstart)
