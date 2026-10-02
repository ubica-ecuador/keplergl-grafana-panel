# Base maps and relief

Every base map the panel offers works **without a Mapbox account**. That is a design constraint,
not a coincidence, and it is the reason the picker looks different from stock kepler.gl's.

## What is on offer

| Choice                    | Source            | Notes                                     |
| ------------------------- | ----------------- | ----------------------------------------- |
| **Match theme** (default) | OpenFreeMap       | Dark in dark mode, Positron in light      |
| Positron (OpenFreeMap)    | OpenFreeMap       | no key, no account                        |
| Bright (OpenFreeMap)      | OpenFreeMap       | no key, no account                        |
| Liberty (OpenFreeMap)     | OpenFreeMap       | with its own 3D buildings                 |
| Dark (OpenFreeMap)        | OpenFreeMap       | no key, no account                        |
| Fiord (OpenFreeMap)       | OpenFreeMap       | no key, no account                        |
| Dark Matter (CARTO)       | CARTO             | kepler's own entry; optional key          |
| Positron (CARTO)          | CARTO             | kepler's own entry; optional key          |
| Voyager (CARTO)           | CARTO             | kepler's own entry; optional key          |
| Satellite (Esri)          | Esri              | flat imagery                              |
| Satellite + relief        | Esri + Mapterhorn | imagery over real elevation               |
| Topographic + relief      | Esri + Mapterhorn | topographic map over real elevation       |
| No Basemap                | —                 | empty background, no tiles fetched at all |
| Self-hosted `style.json`  | you               | for air-gapped installs                   |

<video src="/img/guide-basemap-relief.mp4" poster="/img/guide-basemap-relief.jpg" autoplay loop muted playsinline controls aria-label="The Satellite + relief base map: an accessibility isochrone draped over Esri imagery on real elevation, tilted so the valley around Cuenca shows" style="width:100%;height:auto;border-radius:8px"></video>

## Why the list is replaced rather than extended

kepler.gl ships nine default base maps, and **five of them are Mapbox styles** — Satellite With
Streets, Dark, Light, Muted Light, Muted Night. Every one is a `mapbox://` URL that cannot load
without an account. Left in place they sit in the picker as choices that blank the map when clicked,
which is a worse experience than not offering them.

So the panel replaces kepler's list entirely, puts [OpenFreeMap](https://openfreemap.org)'s five
styles first, and re-registers the three that work without a Mapbox token — CARTO's — from kepler's
own definitions rather than by copying them, so an upstream rename surfaces as a test failure
instead of a silently broken entry.

## CARTO and its key

Since 23 September 2026 CARTO asks for an API key, and without one its tiles may come back with an
"API key required" watermark. That is why _Match theme_ now uses OpenFreeMap rather than CARTO's Dark
Matter and Positron. CARTO's entries keep their ids, so a dashboard saved on one still opens there.
To use them cleanly, get a free key at [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey/)
and paste it into **CARTO API key**: the panel adds it to every CARTO style, sprite, glyph and tile
URL. The key is public by design — it travels in every tile URL — and dashboard variables are
interpolated. Keys registered before 23 September 2026 work until 30 November 2026.

## Map Layers switches

kepler's _Map Layers_ panel shows a switch per group of style layers — labels, roads, water and so
on. In this panel:

- the filters ignore case, so a style with ids such as `Water` or `Road` gets its switches too;
- OpenMapTiles styles (OpenFreeMap, CARTO, most self-hosted ones) get a **Points of interest**
  switch, translated where kepler has the language;
- **3D Building** appears only where the style draws its own extruded buildings — Liberty, or a
  self-hosted style that has them. kepler's own 3D buildings need a Mapbox token this panel does not
  use, so on other styles the switch did nothing;
- a self-hosted `style.json` shows the switches its own layers answer to, and keeps their states when
  you change base map and come back.

"No Basemap" is re-added deliberately: it is how a dashboard shows data on a plain background with
no tiles requested at all, and replacing the list would otherwise have dropped it along with the
Mapbox ones.

## Relief

**Satellite + relief** and **Topographic + relief** carry a `terrain` key in their style document,
which MapLibre reads directly. kepler passes it through untouched, which is the entire reason
elevation is possible here — kepler has no terrain feature of its own. The elevation tiles come from
[Mapterhorn](https://mapterhorn.com).

Tilt the camera with the 3D control and the ground rises.

::: warning Your data does not drape over the terrain
The relief belongs to the **base map**. deck.gl draws your data at its own altitude, so points and
paths float at their nominal height rather than following the ground beneath them. A trail through a
valley will not hug the valley floor.

This is a deck.gl property, not a bug in the styles — see
[Under the hood](../../reference/under-the-hood).
:::

A second thing to know before leaning on it: panning a tilted terrain map can make the camera jitter,
an open kepler.gl issue
([keplergl/kepler.gl#3394](https://github.com/keplergl/kepler.gl/issues/3394)).

## Thumbnails

The OpenFreeMap and CARTO thumbnails **ship with the plugin**, rendered once from each real style.
kepler names its own thumbnails as paths under whatever asset base the host application configures,
and this plugin points that at its own assets, so kepler's paths would 404. Raster tiles from CARTO
stood in for a while, until CARTO began watermarking them without a key; a file in the plugin
carries no watermark and needs no network. The Esri thumbnails are still real tiles at zoom 3.

kepler renders them as `<img>`, so they fall under Grafana's `img-src`, which is open. The tiles
themselves are fetched by MapLibre over XHR and fall under `connect-src`, which is not.

## Content Security Policy

On a hardened Grafana each choice needs its host allowed in `connect-src`:

| Choice                          | Host to allow                                                         |
| ------------------------------- | --------------------------------------------------------------------- |
| OpenFreeMap's five, Match theme | `https://tiles.openfreemap.org`                                       |
| CARTO's three                   | `https://basemaps.cartocdn.com` and `https://*.basemaps.cartocdn.com` |
| Satellite, Topographic          | `https://services.arcgisonline.com`                                   |
| Either relief style             | the above, plus `https://tiles.mapterhorn.com`                        |
| No Basemap                      | nothing                                                               |
| Self-hosted                     | your own host                                                         |

Leave out the ones you never select. One exception: kepler starts on CARTO's Dark Matter before the
panel applies its own base map, so every load requests that one style document from
`basemaps.cartocdn.com`. Without the CARTO hosts the map still draws, but the browser logs a blocked
request. Full configuration in [Install](../install#hardened-grafana).

## Self-hosted style.json

Set **Base map** to _Self-hosted style.json_ and give it a URL. This is the answer for an air-gapped
install, and also for anyone who would rather not depend on a third party's tile service or accept
Esri's terms.

Anything MapLibre can read works, including one with its own `terrain` key — the panel does not
special-case its own relief styles, it simply passes the document to MapLibre.

## Esri's terms of use

The satellite and topographic imagery come from Esri's public `services.arcgisonline.com` endpoint,
whose terms ask for an ArcGIS account for production use. An install that needs a cleaner footing
should point **Base map** at its own `style.json`.

## Interaction with saved configurations

A saved map configuration names its own base map, and **it wins over the panel option**. If you save
a map while looking at satellite imagery and later switch the Base map option to Positron, the
saved configuration will put you back on satellite. Re-save the map to change it.

This is also why the layer gallery dashboard does not follow the Grafana theme: pinning a specific
layer type requires a saved configuration, and a saved configuration brings its base map with it.
