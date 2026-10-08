# Content Security Policy

On a Grafana with `content_security_policy = true`, the browser only fetches from the hosts your policy lists. Plus
needs the free panel's hosts, which [Hardened Grafana](/guide/install#hardened-grafana) in the free panel's install
guide lists and explains, plus the hosts of the providers whose keys you set. This page lists only the hosts Plus
adds.

## `connect-src`

Base maps and 3D tiles are fetched as data, so their hosts go in `connect-src`. Add only the rows for the keys you
set on the configuration page.

| Service                        | Hosts                                              | What the browser fetches there                                       |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| CARTO                          | `basemaps.cartocdn.com`, `*.basemaps.cartocdn.com` | Already in the free panel's list; the CARTO key changes nothing here |
| MapTiler                       | `api.maptiler.com`                                 | Styles, tiles, thumbnails and the terrain under **Relief**           |
| Esri                           | `basemapstyles-api.arcgis.com`, and see below      | The basemap styles                                                   |
| Esri and Azure Maps **Relief** | `tiles.mapterhorn.com`                             | Already in the free panel's list                                     |
| Azure Maps                     | `atlas.microsoft.com`                              | Tiles, and the attribution of the view                               |
| Google base maps               | `tile.googleapis.com`                              | The session, the tiles, and the copyright of the view                |
| Google Photorealistic 3D Tiles | `tile.googleapis.com`                              | The 3D tiles                                                         |
| A Fleet layer's own 3D model   | wherever the model is served                       | The model file                                                       |

Esri's style names further Esri hosts for its tiles, fonts and sprites, so `basemapstyles-api.arcgis.com` alone is
not enough. `https://*.arcgis.com` covers them. If you would rather list hosts one by one, open an Esri base map with
the browser's developer tools open and add each host the console reports as blocked.

Everything else Plus fetches comes from your Grafana itself, so `'self'` covers it:

- the keys, read from the app's settings;
- the Places data files: country outlines, airports, the IP-to-country table and the region boundaries, all shipped
  inside the plugin;
- the 3D models bundled with the Fleet layer;
- active alerts, read through Grafana's own alerting API.

See [Privacy](/plus/admin/privacy) for what each of these requests carries.

## `img-src`

Grafana's default policy allows images from any host, and then nothing here is needed. If your template narrows
`img-src`, add:

| Service    | Host                    | What it serves                                      |
| ---------- | ----------------------- | --------------------------------------------------- |
| MapTiler   | `api.maptiler.com`      | The thumbnails in kepler's base map picker          |

## An example

The free panel's list, followed by every host Plus adds:

```ini
content_security_policy_template = """… connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://services.arcgisonline.com https://tiles.mapterhorn.com https://titiler.xyz https://api.maptiler.com https://*.arcgis.com https://atlas.microsoft.com https://tile.googleapis.com …;"""
```

`https://*.arcgis.com` does not cover the free panel's `services.arcgisonline.com`, which is under another domain,
so keep both.

Leave out the hosts of providers you have no key for. When a host is missing, the map draws nothing from it, and
the browser's console names the blocked host.
