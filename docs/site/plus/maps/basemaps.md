# Base maps

Plus keeps every base map of the free panel and adds the keyed styles of four providers: MapTiler, Esri, Azure
Maps and Google. With a CARTO key it also keys the free panel's three CARTO maps. The free choices, Relief on
the free styles, self-hosted `style.json` and the effect of a saved configuration are described in
[Base maps and relief](/guide/map/basemaps-and-relief). This page covers only what Plus adds.

## Where the keys go

An administrator sets each provider's key once, on the configuration page of Kepler Geospatial Maps Plus
(**Administration → Plugins → Kepler Geospatial Maps Plus**). From then on, that provider's styles appear in
kepler's base map picker on every Plus panel in the organisation, after the free ones. A provider without a
key offers nothing, and with no keys at all the picker shows the free base maps only.

No dashboard holds a key: a saved map names the style, and the key comes from the app when the map loads.
Anyone who can open a dashboard can read the keys, which is why each one should be restricted. See
[Keys and who can read them](/plus/admin/keys).

## Providers at a glance

| Provider   | Key field                        | What the key can be restricted to               | Attribution on the map                         | `connect-src`                                                         |
| ---------- | -------------------------------- | ----------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| MapTiler   | **MapTiler API key**             | this Grafana's URL                              | the style's own                                | `https://api.maptiler.com`                                            |
| Esri       | **ArcGIS API key**               | this Grafana's URL                              | "Powered by Esri" and the style's data sources | `https://basemapstyles-api.arcgis.com`, and the hosts its style names |
| Azure Maps | **Azure Maps subscription key**  | **nothing**: it cannot be restricted by address | Microsoft's, asked for when the page loads     | `https://atlas.microsoft.com`                                         |
| Google     | **Google Maps Platform API key** | the Map Tiles API, with a daily quota           | Google Maps logo and the copyright of the view | `https://tile.googleapis.com`                                         |
| CARTO      | **CARTO basemaps API key**       | the restrictions CARTO's dashboard offers       | CARTO's, as in the free panel                  | `https://basemaps.cartocdn.com` and `https://*.basemaps.cartocdn.com` |

Relief on Esri and Azure Maps also needs `https://tiles.mapterhorn.com`. Esri's style document names further
Esri hosts for its tiles, sprites and fonts; the browser's console lists any request the policy blocks. The
full configuration is on [Content Security Policy](/plus/admin/csp).

## Styles in the picker

| Provider   | Styles                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MapTiler   | MapTiler Streets, MapTiler Streets Dark, MapTiler Outdoor, MapTiler Topo, MapTiler Winter, MapTiler Dataviz, MapTiler Dataviz Dark, MapTiler Satellite, MapTiler Hybrid |
| Esri       | Esri Navigation, Esri Navigation Night, Esri Streets, Esri Topographic, Esri Outdoor, Esri Light Gray, Esri Dark Gray, Esri Imagery                                     |
| Azure Maps | Azure Maps Road, Azure Maps Dark Grey, Azure Maps Imagery, Azure Maps Hybrid                                                                                            |
| Google     | Google Roadmap, Google Satellite, Google Hybrid, Google Terrain                                                                                                         |
| CARTO      | no new styles: the free panel's Dark Matter, Positron and Voyager ask CARTO with the key                                                                                |

What each key needs, as the configuration page states it:

- **MapTiler**: restrict the key to this Grafana's URL in your MapTiler account.
- **Esri**: an ArcGIS Location Platform API key, not one from ArcGIS Online, with the basemap styles
  privilege, restricted to this Grafana's URL. Esri keys expire within a year.
- **Azure Maps**: a subscription key from your Azure Maps account. The configuration page warns next to the
  field that it cannot be restricted to this Grafana's address: use a key from an Azure Maps account kept for
  this Grafana, with a spending cap, and rotate it if it leaks.
- **Google**: the Map Tiles API enabled on the key. Restrict the key to that API and set a daily quota in
  Google Cloud.
- **CARTO**: free from [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey/); add restrictions to it
  in CARTO's dashboard.

A few things differ by provider:

- **Google** draws its labels in the Grafana user's language. Accounts billed in the European Economic Area
  get no **Google Satellite** or **Google Hybrid**: Google serves them Roadmap and Terrain only. Past zoom 19
  (Satellite, Hybrid) or 15 (Terrain) the map enlarges the last tiles rather than ask Google for more.
- **Azure Maps Imagery**, and the imagery under **Azure Maps Hybrid**, stop at zoom 19.
- **Esri** and **Google** show a drawn colour swatch in the picker instead of a map thumbnail.

## Keyed CARTO

Without a key, CARTO may answer with an "API key required" watermark; the free page explains why. With the
organisation's CARTO key, Dark Matter, Positron and Voyager ask CARTO with it on every request the map makes:
the style, the thumbnails, the tiles, the sprites and the fonts. The entries keep their names and ids, so a
dashboard saved on one opens on it with or without a key.

The free panel's own **CARTO API key** option still works. A panel that sets one uses it, and the
organisation's key goes only on CARTO requests that carry none.

## Map Layers switches

kepler's _Map Layers_ panel shows one switch per group of the style's layers. Which ones a Plus style gets
depends on its provider:

| Styles                    | Switches                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| MapTiler, all nine        | Label, Points of interest, Road, Border, Building, Water, Land, 3D Building, Relief |
| Esri, all eight           | Relief                                                                              |
| Azure Maps, all four      | Relief                                                                              |
| Google, all four          | none: the tiles are images, and Relief is left off (see below)                      |
| CARTO and the free styles | as in the free panel                                                                |

A MapTiler switch is shown only when the loaded style has layers for it.

- **3D Building** on MapTiler draws MapTiler's own extruded buildings, from zoom 15. It starts on, except when
  the map comes from a style where it was off: kepler carries a switch's state from one style to the next. Its
  colour picker is off, because kepler's picker paints only kepler's own 3D buildings, which need a Mapbox
  token.
- **Building** on MapTiler draws the flat footprints at every zoom, so a city does not go empty when **3D
  Building** is off. It starts off on styles that have 3D buildings.
- **Points of interest** on MapTiler switches MapTiler's shops, stations, hospitals and other points, which
  kepler would otherwise switch with the labels.

### Relief

The **Relief** switch adds real elevation under the base map. It starts off. Tilt the camera with the 3D
control to see the ground rise.

| Styles     | Elevation                                                                   |
| ---------- | --------------------------------------------------------------------------- |
| MapTiler   | MapTiler's own terrain, with the organisation's MapTiler key                |
| Esri       | [Mapterhorn](https://mapterhorn.com)'s public terrain, as in the free panel |
| Azure Maps | Mapterhorn's public terrain                                                 |

Google's styles have no Relief. Google's terms forbid using its maps with or near a map from another provider,
and relief would lay Google's tiles over another provider's elevation.

As on the free relief styles, your data does not drape over the terrain: it stays at its own height. See
[Base maps and relief](/guide/map/basemaps-and-relief#relief).

## The sky

Tilt the map far enough for the horizon to show and a sky appears above it: a day sky over light styles and
imagery, a night sky over dark styles. A haze fades the far map into the horizon. Seen from above, the map
looks as it did without one.

The sky is drawn on every base map, the free ones included, except two:

- **Google's**, whose policies are strict about altering their maps;
- **No Basemap**, which is a plain background by design.

A self-hosted style that sets its own sky keeps it. Labels moved to the top in Map Layers are drawn without
the sky, so it never covers your data.

## When a key is missing or refused

A dashboard saved on a keyed style does not open on a blank map. It opens on the free default, _Match theme_,
with a notice that says why:

| What happened                                                        | The notice says                                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The organisation has no key for the provider                         | the base map needs a key, and an administrator can add it on the configuration page                              |
| The provider refused the key                                         | the provider did not serve the base map: its key may have expired, been revoked, or be restricted to other sites |
| Google serves the organisation's account no satellite or hybrid maps | Google does not serve that base map to the account, because it is billed in the European Economic Area           |
| The provider did not answer within 15 seconds                        | the provider did not answer for the base map                                                                     |
| The saved style is not one this Plus knows                           | the saved base map is not available here                                                                         |

Azure Maps and Google keys are checked when the page loads. A key that fails the check, or gets no answer
within 5 seconds, is treated as refused on that page, and its styles are left out of the picker. MapTiler and
Esri keys are found refused only when a map asks for one of their styles.

## Terms the organisation accepts

Requests go straight from the viewer's browser to the provider, with the organisation's key, and each
provider's terms apply to its maps.

- **Google**: unless the Google Maps Platform account is billed in the European Economic Area, Google's terms
  forbid showing a Google map with or near a map from another provider. Keep Google base maps off dashboards
  that show CARTO, MapTiler, Esri or Azure Maps maps. Tell your users that these maps include Google Maps
  content, under Google's terms ([maps.google.com/help/terms_maps](https://maps.google.com/help/terms_maps))
  and privacy policy. The configuration page says this next to the key.
- **Esri**: the terms of your ArcGIS Location Platform account. Esri asks for "Powered by Esri" on the map,
  which Plus adds.
- **Azure Maps**: Microsoft's terms for Azure Maps. Microsoft asks for its attribution wherever its tiles are
  drawn, which Plus adds.
- **MapTiler**: the terms of your MapTiler account.
- **CARTO**: CARTO's terms for its basemaps.
