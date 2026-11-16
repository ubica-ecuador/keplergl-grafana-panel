# Base maps and relief

Every base map the panel offers works **without a Mapbox account**. That is a design constraint,
not a coincidence, and it is the reason the picker looks different from stock kepler.gl's.

## What is on offer

| Choice                    | Source            | Notes                                         |
| ------------------------- | ----------------- | --------------------------------------------- |
| **Match theme** (default) | OpenFreeMap       | Dark in dark mode, Positron in light          |
| Positron (OpenFreeMap)    | OpenFreeMap       | no key, no account                            |
| Bright (OpenFreeMap)      | OpenFreeMap       | no key, no account                            |
| Liberty (OpenFreeMap)     | OpenFreeMap       | with its own 3D buildings                     |
| Dark (OpenFreeMap)        | OpenFreeMap       | no key, no account                            |
| Fiord (OpenFreeMap)       | OpenFreeMap       | no key, no account                            |
| Dark Matter (CARTO)       | CARTO             | kepler's own entry; no key                    |
| Positron (CARTO)          | CARTO             | kepler's own entry; no key                    |
| Voyager (CARTO)           | CARTO             | kepler's own entry; no key                    |
| Satellite (Esri)          | Esri              | flat imagery                                  |
| Satellite + relief        | Esri + Mapterhorn | imagery over real elevation                   |
| Topographic + relief      | Esri + Mapterhorn | topographic map over real elevation           |
| Seamap (Open Waters)      | Open Waters       | nautical chart; [not for navigation](#seamap) |
| No Basemap                | —                 | empty background, no tiles fetched at all     |
| Self-hosted `style.json`  | you               | for air-gapped installs                       |

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

## CARTO without a key

The panel asks CARTO for Dark Matter, Positron and Voyager without a key. Their vector styles and
tiles still draw without one; since 23 September 2026 CARTO asks for a key, and its raster tiles
carry an "API key required" watermark without one. That is why _Match theme_ uses OpenFreeMap
rather than CARTO's Dark Matter and Positron. CARTO's entries keep their ids, so a dashboard saved on
one still opens there.

Up to 1.6, the panel had a **CARTO API key** option. It is gone since 1.7.0: a panel option is saved
in the dashboard's JSON, where everyone who can view the dashboard can read it. A dashboard saved
with a key opens without it, and its next save leaves the key out. To draw CARTO with your own key,
serve a copy of its style whose sources list the tile URLs with your key (CARTO's own style points at
a TileJSON whose tile URLs carry none) and choose **Base map** → _Self-hosted style.json_ (see
below); for a new map, prefer the OpenFreeMap styles, which need no key.

## Map Layers switches

kepler's _Map Layers_ panel shows a switch per group of style layers — labels, roads, water and so
on. In this panel:

- the filters ignore case, so a style with ids such as `Water` or `Road` gets its switches too;
- OpenMapTiles styles (OpenFreeMap, CARTO, most self-hosted ones) and Shortbread ones (VersaTiles,
  the land of Seamap) get a **Points of interest** switch, translated where kepler has the language;
- Seamap gets **Seamarks** and **Depths** switches of its own (see [Seamap](#seamap));
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

The relief belongs to the **base map**, and deck.gl, which draws your data, knows nothing of it. The
panel lays three kinds of layer on it; the rest stay at their own altitude:

| Layer                                                  | On a relief base map                                     |
| ------------------------------------------------------ | -------------------------------------------------------- |
| **Rasters**                                            | lie on the ground, over hills and into valleys           |
| **Markers** and **symbols**                            | stand on the ground, labels and shadows with them        |
| Points, paths, arcs, polygons, hexagons and the others | float at their own height: a trail does not hug a valley |

The same goes for a self-hosted `style.json` that carries a `terrain` key.

### Rasters on the relief

There are two ways a raster comes to lie on the relief, and which one it takes depends on the layer:

- **MapLibre draws it.** XYZ tiles, Zarr tiles from TiTiler, a COG the tile server paints
  ([Let the tile server paint](../data/rasters#painted)), an [ArcGIS Image Service](../data/arcgis-image-service)
  and a [WMS](../data/wms) that answers no click are handed to the base map as raster layers of its
  own: they lie on the very surface the base map lies on, and MapLibre asks for coarser tiles far off
  under a tilted camera, as it does for its own imagery. deck draws nothing for them.
- **deck draws it on a grid on the ground.** kepler's Raster Tile layer (a COG the browser colours, a
  PMTiles archive), the Image layer and a WMS that answers clicks are drawn by deck as before, on a
  grid whose every point is lifted to the ground, about one cell every 12 pixels. A WMS stays with deck
  while it answers clicks because kepler asks the service about the pixel deck found under the
  pointer.

kepler's own [Zarr layer, read in the browser](../data/zarr#kepler-s-own-zarr-layer-in-the-browser),
is still drawn flat.

What it costs:

- **A raster MapLibre draws lies under every deck layer**, whatever its place in kepler's layer
  list: points, paths and polygons are always on top of it. Among themselves, and above the base map,
  those rasters keep kepler's order.
- **A raster on deck's grid asks for more tiles under a tilted camera**: deck has no coarser tiles
  for the distance, so near the horizon it asks for as many as close by.
- On a flat base map, or once the relief is switched off, every raster is drawn by deck flat, as
  before.

A second thing to know before leaning on it: panning a tilted terrain map can make the camera jitter,
an open kepler.gl issue
([keplergl/kepler.gl#3394](https://github.com/keplergl/kepler.gl/issues/3394)).

## Seamap

**Seamap (Open Waters)** is a nautical chart from [Open Waters](https://openwaters.io/charts/seamap),
with no key and no account. It draws OpenStreetMap's seamarks, rebuilt every week: buoys and beacons,
lights with their characteristics and sectors, hazards and wrecks, traffic separation schemes,
ferry routes, harbours. They lie over shaded depths, depth areas, contours and soundings from Open
Waters' [Seascape](https://openwaters.io/charts/seascape) bathymetry, a mosaic of GEBCO, EMODnet,
NOAA and some thirty other surveys. The land is a VersaTiles map of OpenStreetMap.

Seamap is **not for navigation**: seamarks may be missing, out of date or wrong. Use official
charts at sea.

Two switches of its own sit at the top of _Map Layers_:

- **Seamarks**: every buoy, light, sector, hazard, lane and route. It can go on top of your layers,
  as labels can. kepler's own label switch would otherwise have taken the buoys and lights, and the
  light sectors and lanes had no switch at all.
- **Depths**: the shading, depth areas, contours and soundings.

The usual switches cover the land: labels (sea area names among them), points of interest, roads,
borders, buildings, water and land.

How much it shows depends on where you look. Where OpenStreetMap maps the seamarks well, such as
much of Europe, it reads like a paper chart. Elsewhere the depths may be coarse (GEBCO's grid only)
and the seamarks few.

The tiles are under CC BY 4.0, and the map credits Open Waters, OpenStreetMap and the elevation
sources in its attribution. Open Waters runs the service with no stated limits and no service level;
an install that needs one should serve its own copy as a [self-hosted style](#self-hosted-style-json).

## Thumbnails

The OpenFreeMap, CARTO and Seamap thumbnails **ship with the plugin**, rendered once from each real style.
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
| Seamap                          | `https://tiles.openwaters.io` and `https://tiles.versatiles.org`      |
| No Basemap                      | nothing                                                               |
| Self-hosted                     | your own host                                                         |

Leave out the ones you never select. Full configuration in [Install](../install#hardened-grafana).

## Self-hosted style.json

Set **Base map** to _Self-hosted style.json_ and give it a URL. This is the answer for an air-gapped
install, and also for anyone who would rather not depend on a third party's tile service or accept
Esri's terms.

Anything MapLibre can read works, including one with its own `terrain` key — the panel does not
special-case its own relief styles, it simply passes the document to MapLibre.

The attribution credits every source of the style, including those whose credit only arrives with
their TileJSON, after the map has started drawing.

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
