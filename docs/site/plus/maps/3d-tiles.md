# 3D tiles

Plus adds Google Photorealistic 3D Tiles, the photorealistic 3D mesh of cities, drawn with the organisation's own
key. It is added from a **3D (Plus)** tab in kepler's **Add Data** dialog and becomes an ordinary kepler 3D tile
layer.

::: info Cesium ion
Assets of a Cesium ion account are not in this version of Plus. A map saved with one says so instead of drawing it.
:::

kepler's own **Add Data → Tileset → 3D Tile** form is still there for any other tileset, with a URL and a
token you type yourself. See [Layers configured with a URL](/layers/url-configured).

## Before you start

An administrator sets the keys on the configuration page of Kepler Geospatial Maps Plus (**Administration →
Plugins → Kepler Geospatial Maps Plus**):

| Source                         | Key field                        | What the configuration page asks for                                                                                     |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Google Photorealistic 3D Tiles | **Google Maps Platform API key** | the Map Tiles API enabled; the key restricted to that API, with a daily quota. It is the same key as Google's base maps  |

Anyone who can open a dashboard can read these keys. See [Keys and who can read them](/plus/admin/keys).

## Add a layer

Open kepler's side panel, choose **Add Data**, and open the **3D (Plus)** tab.

**Google Photorealistic 3D Tiles.** Select **Add Google Photorealistic 3D**. Plus first asks Google whether it
serves 3D tiles to the organisation's key, then adds a layer named _Google Photorealistic 3D_. Each map load
counts as one 3D session on the organisation's Google account, and so does this check.

The button is greyed out when the organisation has no Google key, and the tab says why.

## Keys stay out of dashboards

A layer added from the 3D (Plus) tab carries no key. The key is added when the layer is drawn, so a saved
dashboard, an exported one and the map configuration JSON hold none.

A token typed into kepler's own 3D Tile form, for a Google tileset, is dropped when the
dashboard is saved if the organisation has its own key for that provider: the layer draws with the
organisation's key instead. Where the organisation has no key for the provider, the typed token is kept,
because the layer needs it.

The organisation's Google key is sent only to Google's own 3D Tiles service at `tile.googleapis.com`. A
tileset hosted anywhere else, even under another Google domain, never receives it.

## Logos and attributions

Plus draws a block at the bottom left of the map, beside the side panel when it is open:

- a **Google** line, with the Google Maps logo and the copyrights of the 3D tiles in view, joined with the
  copyright of a Google base map when one is showing.

The line shows only while a Google 3D layer is visible. The block replaces the attribution kepler would otherwise
write for the layer.

## Height

A 3D tileset states its geometry at its real altitude, while the map is flat at height 0. The layer settings
carry two controls, from the free panel:

- **Sit on the ground**, on by default, brings the tileset's ground down to height 0, where your data is
  drawn. Without it, a mesh surveyed at 2,500 m would float 2,500 m above the map and often not draw at all.
  For a tileset of buildings round the whole world, each building is set on the ground on its own.
- **Height adjustment (m)**, from −4,000 to 4,000, lifts or lowers the tileset on top of that, for a tileset
  whose own idea of its ground is wrong.

## Your data and the tiles

Your layers and the 3D tiles share one 3D scene on that flat ground. A point at height 0 sits at the foot of
the buildings, and when the map is tilted a building in the tiles can stand in front of a mark. Sparkline and
Fleet cards are drawn over everything, 3D tiles included.

The base map's **Relief** lifts only the base map, not the tiles or your data. Leave it off under a 3D layer,
or the base map's ground and the tiles' ground part ways. See
[Base maps and relief](/guide/map/basemaps-and-relief#relief).

## Where Google 3D is not offered

- **Accounts billed in the European Economic Area.** Google does not serve Photorealistic 3D Tiles to them,
  and refuses the key. The tab and the layer's notice say so.
- **Next to another provider's map.** Google's terms forbid showing its maps with or near a map from another
  provider. Draw Photorealistic 3D Tiles over a Google base map or over **No Basemap**, not over CARTO,
  MapTiler, Esri or Azure Maps maps. Plus does not enforce this: the tab and the configuration page state it,
  and the organisation answers for it.
- **A page where the Google key was turned away.** Plus checks the Google key when the page loads. If Google
  refused it, or did not answer within 5 seconds, neither Google's base maps nor its 3D tiles are offered on
  that page.

## Terms the organisation accepts

- **Google**: the same terms as Google's base maps, on
  [Base maps](/plus/maps/basemaps#terms-the-organisation-accepts).

## Content Security Policy

On a Grafana with `content_security_policy = true`, allow in `connect-src`:

| Source     | Host to allow                                                |
| ---------- | ------------------------------------------------------------ |
| Google 3D  | `https://tile.googleapis.com`                                |

See [Content Security Policy](/plus/admin/csp).

## Troubleshooting

| What you see                                                                          | What it means                                                                                                                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No Google key is set" in the tab                                                     | The organisation has no key for the provider. An administrator adds it on the configuration page.                                                        |
| "Google turned this organisation's key away, or did not answer, when the page loaded" | The key failed the check at page load. Reload once the key is fixed.                                                                                     |
| "Google refused this organisation's key for Photorealistic 3D Tiles"                  | The Map Tiles API is off for the key, the key is restricted to other sites, or the account is billed in the European Economic Area.                      |
| A notice that a 3D layer "needs a Google key"                                         | The dashboard was saved with the layer, and this organisation has no key for the provider.                                                               |
| A notice that Google "did not serve" the 3D layer                                     | The provider refused the key when the layer asked for tiles, for the reasons above.                                                                      |
| A notice that a 3D layer "is a Cesium ion asset" and ion "is not available in this version" | The dashboard was saved, on another version or edition, with a Cesium ion asset. Remove the layer, or keep it for a version that offers ion. |
| The layer is in the list but nothing shows                                            | Check that **Sit on the ground** is on, that the view is over the tileset's area, and, on a hardened Grafana, that the hosts above are in `connect-src`. |
