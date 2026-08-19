# Install

## Requirements

**Grafana `>=12.0.10 <12.1 || >=12.1.7 <12.2 || >=12.2.5`.**

Those floors are not arbitrary and they are not conservatism. Grafana only added
`react/jsx-runtime` to its module import map in exactly those patches; below them the plugin does
not fail gracefully, it fails to load at all. If the panel shows a module error on a 12.0.x
install, the patch level is the first thing to check.

There is no backend component and nothing to install on the server beyond the plugin itself.

## Installing the plugin

The plugin is **not yet in the Grafana catalog** — that is planned for 1.0, together with signing.
Until then, install it from the release archive.

1. Download the release zip and unpack it into Grafana's plugin directory, so that you end up with
   a `ubica-keplergl-panel` folder there. The default location is `/var/lib/grafana/plugins` on a
   package install, and `data/plugins` relative to the working directory otherwise; whatever your
   `paths.plugins` setting says wins.
2. Because it is unsigned while it is pre-1.0, allow it explicitly in `grafana.ini`:

   ```ini
   [plugins]
   allow_loading_unsigned_plugins = ubica-keplergl-panel
   ```

3. Restart Grafana.
4. Confirm it loaded under **Administration → Plugins**, and that **Maps by Kepler.gl** appears in
   the visualisation picker when you edit a panel.

::: warning An unsigned plugin is a decision, not a formality
`allow_loading_unsigned_plugins` disables a real check. Only list plugins you obtained from a
source you trust, and prefer verifying the archive's checksum against the release page.
:::

### With Docker

Mount the unpacked plugin and set the same allowance as an environment variable:

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

Unsigned plugins cannot be installed on Grafana Cloud. A Cloud install has to wait for the signed
catalog release.

## Hardened Grafana

With `content_security_policy = true` the map loads and its Web Workers start, but the base map
goes blank: MapLibre fetches styles, sprites, glyphs and tiles over XHR, so every one of them falls
under `connect-src`.

```ini
content_security_policy_template = """… connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://services.arcgisonline.com https://tiles.mapterhorn.com …;"""
```

Each host serves only what its name suggests:

| Host                        | What it serves                                      |
| --------------------------- | --------------------------------------------------- |
| `basemaps.cartocdn.com`     | Carto's Dark Matter, Positron and Voyager base maps |
| `services.arcgisonline.com` | Esri's satellite and topographic imagery            |
| `tiles.mapterhorn.com`      | Elevation tiles behind the two relief styles        |

Leave out the ones whose base maps you never select — or point **Base map** at a `style.json` on
your own network and skip the list entirely. See [Base maps and relief](./map/basemaps-and-relief).

Note that these hosts are for the _base map_. Your own data never leaves Grafana: it arrives
through the data source you already configured, and the panel draws it locally.

## Esri's terms of use

The satellite and topographic imagery come from Esri's public `services.arcgisonline.com`
endpoint, whose terms ask for an ArcGIS account for production use. An install that needs a
cleaner footing should point **Base map** at its own `style.json`.

## Next

[Quickstart →](./quickstart)
