# Base maps and relief

Every base map the panel offers works **without a Mapbox account**. That is a design constraint,
not a coincidence, and it is the reason the picker looks different from stock kepler.gl's.

## What is on offer

| Choice                    | Source            | Notes                                       |
| ------------------------- | ----------------- | ------------------------------------------- |
| **Match theme** (default) | Carto             | Dark Matter in dark mode, Positron in light |
| Dark Matter               | Carto             | kepler's own entry                          |
| Positron                  | Carto             | kepler's own entry                          |
| Voyager                   | Carto             | kepler's own entry                          |
| Satellite (Esri)          | Esri              | flat imagery                                |
| Satellite + relief        | Esri + Mapterhorn | imagery over real elevation                 |
| Topographic + relief      | Esri + Mapterhorn | topographic map over real elevation         |
| No Basemap                | —                 | empty background, no tiles fetched at all   |
| Self-hosted `style.json`  | you               | for air-gapped installs                     |

## Why the list is replaced rather than extended

kepler.gl ships nine default base maps, and **five of them are Mapbox styles** — Satellite With
Streets, Dark, Light, Muted Light, Muted Night. Every one is a `mapbox://` URL that cannot load
without an account. Left in place they sit in the picker as choices that blank the map when clicked,
which is a worse experience than not offering them.

So the panel replaces kepler's list entirely and re-registers the three that do work without a
token — Carto's — from kepler's own definitions rather than by copying them, so an upstream rename
surfaces as a test failure instead of a silently broken entry.

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

A second thing to know before leaning on it: kepler pins MapLibre 4, where panning a tilted terrain
map can make the camera jitter
([keplergl/kepler.gl#3394](https://github.com/keplergl/kepler.gl/issues/3394)).

## Thumbnails

The style picker's thumbnails are **real tiles from the service each style draws**, at zoom 3. That
is deliberate on two counts: kepler names its own thumbnails as paths under whatever asset base the
host application configures — and this plugin points that at its own assets, so kepler's thumbnail
paths would 404 — and a thumbnail fetched from the same service as the style is honest, because when
it is unreachable, so is the style it stands for.

kepler renders them as `<img>`, so they fall under Grafana's `img-src`, which is open. The tiles
themselves are fetched by MapLibre over XHR and fall under `connect-src`, which is not.

## Content Security Policy

On a hardened Grafana each choice needs its host allowed in `connect-src`:

| Choice                         | Host to allow                                                         |
| ------------------------------ | --------------------------------------------------------------------- |
| Carto's three, and Match theme | `https://basemaps.cartocdn.com` and `https://*.basemaps.cartocdn.com` |
| Satellite, Topographic         | `https://services.arcgisonline.com`                                   |
| Either relief style            | the above, plus `https://tiles.mapterhorn.com`                        |
| No Basemap                     | nothing                                                               |
| Self-hosted                    | your own host                                                         |

Leave out the ones you never select. Full configuration in [Install](../install#hardened-grafana).

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
