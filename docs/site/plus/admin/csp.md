# Content Security Policy

On a Grafana with `content_security_policy = true`, the browser only fetches from the hosts your policy lists. Plus
needs the free panel's hosts, which [Hardened Grafana](/guide/install#hardened-grafana) in the free panel's install
guide lists and explains. The base maps and 3D tiles Plus adds are asked for through your Grafana, so Plus adds
little to that list. This page lists what it adds.

## `connect-src`

Base maps and 3D tiles are fetched as data, so their hosts go in `connect-src`.

| Service                      | Hosts                        | What the browser fetches there   |
| ---------------------------- | ---------------------------- | -------------------------------- |
| Azure Maps **Relief**        | `tiles.mapterhorn.com`       | Already in the free panel's list |
| A Fleet layer's own 3D model | wherever the model is served | The model file                   |

Everything else Plus fetches comes from your Grafana itself, so `'self'` covers it:

- the app's settings, which say which keys the organisation has, never the keys themselves;
- Google's base maps and Photorealistic 3D Tiles and Azure Maps' tiles, asked for through the app's proxy on your
  Grafana (`/api/plugin-proxy/ubica-keplerplus-app/…`), which adds the key;
- the Places data files: country outlines, airports, the IP-to-country table and the region boundaries, all shipped
  inside the plugin;
- the 3D models bundled with the Fleet layer;
- active alerts, read through Grafana's own alerting API.

A policy written for Plus 1.3 may list `api.maptiler.com` and `*.arcgis.com` for MapTiler's and Esri's keyed base
maps. Plus 1.4.0 no longer offers those (see [Upgrading from 1.3](/plus/admin/keys#upgrading-from-1-3)), so both can
go. Keep the free panel's `services.arcgisonline.com` while you use its **Satellite (Esri)** or relief styles.

See [Privacy](/plus/admin/privacy) for what each of these requests carries.

## `img-src`

Grafana's default policy allows images from any host, and then nothing here is needed. If your template narrows
`img-src`, keep `'self'`, for the Azure Maps thumbnails in kepler's base map picker, which come through the app's
proxy, and `data:`, for Google's drawn swatches there.

## An example

The free panel's list is all Plus needs, with the host of any Fleet model served from elsewhere:

```ini
content_security_policy_template = """… connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://services.arcgisonline.com https://tiles.mapterhorn.com …;"""
```

When a host is missing, the map draws nothing from it, and the browser's console names the blocked host.
