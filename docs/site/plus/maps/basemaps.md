# Base maps

Plus keeps every base map of the free panel and adds the keyed styles of two providers: Azure Maps and Google. The
free choices, Relief on the free styles, self-hosted `style.json` and the effect of a saved configuration are
described in [Base maps and relief](/guide/map/basemaps-and-relief). This page covers only what Plus adds.

::: info MapTiler and Esri
Since 1.4.0, Plus no longer offers MapTiler's and Esri's keyed base maps, nor takes a CARTO key. A map saved on a
MapTiler or Esri style opens on the free default, with a notice. See
[Upgrading from 1.3](/plus/admin/keys#upgrading-from-1-3).
:::

## Where the keys go

An administrator sets each provider's key once, on the configuration page of Kepler Geospatial Maps Plus
(**Administration → Plugins → Kepler Geospatial Maps Plus**). From then on, that provider's styles appear in
kepler's base map picker on every Plus panel in the organisation, after the free ones. A provider without a
key offers nothing, and with no keys at all the picker shows the free base maps only.

No dashboard holds a key: a saved map names the style, and the key is added when the map asks for its tiles. Google
and Azure Maps tiles are asked for through Grafana, which adds the key, so no browser sees either key. See
[Keys and who can read them](/plus/admin/keys).

## Providers at a glance

| Provider   | Key field                        | What the key can be restricted to               | Attribution on the map                         |
| ---------- | -------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Azure Maps | **Azure Maps subscription key**  | **nothing**: it cannot be restricted by address | Microsoft's, asked for when the page loads     |
| Google     | **Google Maps Platform API key** | the Map Tiles API, with a daily quota           | Google Maps logo and the copyright of the view |

Both are asked for through your Grafana, at `/api/plugin-proxy/ubica-keplerplus-app/…`, so a Content Security
Policy needs no host of theirs: `'self'` covers them. Relief on Azure Maps needs `https://tiles.mapterhorn.com`,
already in the free panel's list. The full configuration is on [Content Security Policy](/plus/admin/csp).

## Styles in the picker

| Provider   | Styles                                                                       |
| ---------- | ---------------------------------------------------------------------------- |
| Azure Maps | Azure Maps Road, Azure Maps Dark Grey, Azure Maps Imagery, Azure Maps Hybrid |
| Google     | Google Roadmap, Google Satellite, Google Hybrid, Google Terrain              |

What each key needs, as the configuration page states it:

- **Azure Maps**: a subscription key from your Azure Maps account, kept in Grafana's encrypted settings. Azure
  cannot restrict a key to an address, so use one from an Azure Maps account kept for this Grafana, with a
  spending cap.
- **Google**: the Map Tiles API enabled on the key. Restrict the key to that API and set a daily quota in
  Google Cloud.

A few things differ by provider:

- **Google** draws its labels in the Grafana user's language. Accounts billed in the European Economic Area
  get no **Google Satellite** or **Google Hybrid**: Google serves them Roadmap and Terrain only. Past zoom 19
  (Satellite, Hybrid) or 15 (Terrain) the map enlarges the last tiles rather than ask Google for more.
- **Azure Maps Imagery**, and the imagery under **Azure Maps Hybrid**, stop at zoom 19.
- **Google** shows a drawn colour swatch in the picker instead of a map thumbnail.

## CARTO without a key

Plus asks CARTO for Dark Matter, Positron and Voyager without a key, as the free panel does when its **CARTO API
key** option is empty. The entries keep their names and ids, so a dashboard saved on one opens on it as before.

Plus takes no CARTO key at all. The free panel's **CARTO API key** option, which saves its key in the dashboard, is
not offered in Plus: the editor leaves it out, a key a dashboard still carries (saved by the free panel or by an
earlier Plus) is never used, and the next save of the dashboard drops it.

Since 23 September 2026 CARTO asks for a key, and without one its raster tiles carry a watermark. The vector styles
of Dark Matter, Positron and Voyager still draw, and their thumbnails in the picker are files shipped with the
plugin. For a new map, prefer the OpenFreeMap styles, which need no key; see
[Base maps and relief](/guide/map/basemaps-and-relief#carto-and-its-key).

## Map Layers switches

kepler's _Map Layers_ panel shows one switch per group of the style's layers. Which ones a Plus style gets
depends on its provider:

| Styles                    | Switches                                                       |
| ------------------------- | -------------------------------------------------------------- |
| Azure Maps, all four      | Relief                                                         |
| Google, all four          | none: the tiles are images, and Relief is left off (see below) |
| CARTO and the free styles | as in the free panel                                           |

### Relief

The **Relief** switch adds real elevation under the base map. It starts off. Tilt the camera with the 3D
control to see the ground rise.

Of the styles Plus adds, Azure Maps' four have it, with [Mapterhorn](https://mapterhorn.com)'s public terrain, the
same elevation as the free panel's **Satellite + relief** and **Topographic + relief**.

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
| The saved style is a MapTiler or Esri one, which 1.4.0 retired       | Plus no longer offers that provider's base maps; pick another base map and save the map to keep it               |
| The saved style is not one this Plus knows                           | the saved base map is not available here                                                                         |

Azure Maps and Google keys are checked when the page loads. A key that fails the check, or gets no answer
within 5 seconds, is treated as refused on that page, and its styles are left out of the picker.

## Terms the organisation accepts

Requests go from the viewer's browser through your Grafana to the provider, with the organisation's key, and each
provider's terms apply to its maps.

- **Google**: unless the Google Maps Platform account is billed in the European Economic Area, Google's terms
  forbid showing a Google map with or near a map from another provider. Keep Google base maps off dashboards
  that show CARTO, OpenFreeMap, Esri or Azure Maps maps. Tell your users that these maps include Google Maps
  content, under Google's terms ([maps.google.com/help/terms_maps](https://maps.google.com/help/terms_maps))
  and privacy policy. The configuration page says this next to the key.
- **Azure Maps**: Microsoft's terms for Azure Maps. Microsoft asks for its attribution wherever its tiles are
  drawn, which Plus adds.
