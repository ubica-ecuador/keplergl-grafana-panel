# Keys and who can read them

Plus draws base maps and 3D layers from services that each need a key. You set each key once, for the whole
organisation, and every Plus panel in it uses them. This page says where each key goes, who can read it, and how to
limit what a copied key can be used for.

## Where each key goes

Open **Administration → Plugins → Kepler Geospatial Maps Plus** and its configuration page. Under **Map service
keys** there is one field per provider. Fill in the ones you use and press **Save keys**. Every key is optional:
without any, Plus draws the free panel's base maps.

| Field                            | What it switches on                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| **CARTO basemaps API key**       | The default Dark Matter, Positron and Voyager base maps, without CARTO's watermark |
| **MapTiler API key**             | MapTiler's base maps, and MapTiler's terrain under their **Relief** switch         |
| **ArcGIS API key**               | Esri's ArcGIS basemap styles                                                       |
| **Google Maps Platform API key** | Google's base maps and Google Photorealistic 3D Tiles                              |
| **Cesium ion access token**      | 3D layers from your Cesium ion account                                             |
| **Azure Maps subscription key**  | Azure Maps' road, dark grey, imagery and hybrid maps                               |

Each field's description says what the provider expects of the key. Two are worth knowing before you create one:

- The **ArcGIS API key** must come from an ArcGIS Location Platform account, not from ArcGIS Online, and have the
  basemap styles privilege. Esri keys expire within a year.
- The **Google Maps Platform API key** needs the Map Tiles API enabled. The configuration page also states Google's
  terms, which limit which other maps a Google map may be shown with.

See [Base maps](/plus/maps/basemaps) and [3D tiles](/plus/maps/3d-tiles) for what each provider draws, and
[Install and configure the app](/plus/start/install) for the first set-up.

## Who can read them

**Any signed-in user of the organisation, Viewers included, can read every key.**

Plus has no backend: nothing of it runs on the Grafana server. Maps are drawn in each viewer's browser, and the
browser asks each provider for tiles directly, with the key, so the browser has to have the key. Plus keeps the keys
in the app's settings and the panel reads them through Grafana's API, which answers any signed-in user of the
organisation. Anyone who opens a dashboard can also see the keys in the browser's network requests.

This is how these providers expect browser keys to be used, and why they let you restrict a key to the site that
uses it. Treat each key as public, and restrict it.

## Restrict each key to your Grafana

Restrict every key to your Grafana's address, so that a copy of it is refused anywhere else. Where the provider
allows it, also restrict what the key can do and set a quota.

| Provider   | What to restrict                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| CARTO      | Add restrictions to the key in CARTO's dashboard                                                                   |
| MapTiler   | Restrict the key to your Grafana's URL in your MapTiler account                                                    |
| Esri       | Restrict the key to your Grafana's URL                                                                             |
| Google     | Restrict the key to your Grafana's URL (website restrictions) and to the Map Tiles API, and set a daily quota      |
| Cesium ion | Give the token only the public `assets:read` scope, only the assets you want on dashboards, and your Grafana's URL |
| Azure Maps | **Cannot be restricted** to an address; see below                                                                  |

Use the address your users type in their browser. A key restricted to another address is refused, and the map shows
a notice saying so; see [While a key is missing or refused](#while-a-key-is-missing-or-refused).

### Azure Maps

An Azure Maps subscription key cannot be restricted to your Grafana's address. Anyone who can open a dashboard can
read it and use it from anywhere. The configuration page warns about this under the field. If you use Azure Maps:

- use a key from an Azure Maps account kept for this Grafana alone,
- set a spending cap on that account,
- rotate the key if it leaks.

### Google and Cesium ion

Both count use against your account. Each map load that draws Google Photorealistic 3D Tiles counts as one 3D
session on your Google account, and the configuration page states Google's free allowance. Cesium ion's Community
plan is for non-commercial use. Read each provider's terms on the configuration page before you add its key.

## Rotating a key

1. Create the new key at the provider, with the same restrictions as the old one.
2. Paste it into its field on the configuration page and press **Save keys**.
3. Revoke the old key at the provider.

A dashboard reads the keys once, when the page loads. A dashboard that was already open keeps using the old key, and
stops loading new tiles once that key is revoked, until the page is reloaded. Esri keys expire on their own within a
year, so plan to rotate those.

## While a key is missing or refused

A missing or refused key never stops a map from drawing. What a viewer sees instead:

- **The base map picker** lists a provider's base maps only once its key is set.
- **A map saved on a keyed base map, with no key set,** opens on the default base map, with a notice such as: _The
  base map "…" needs a MapTiler key, and this organisation has none. Showing … instead. An administrator can add the
  key on the configuration page of Kepler Geospatial Maps Plus._
- **A key the provider refuses**, because it expired, was revoked or is restricted to another address: the map opens
  on the default base map, with a notice such as: _MapTiler did not serve the base map "…". Its key may have expired,
  been revoked, or be restricted to other sites. Showing … instead._
- **CARTO, with no CARTO key**: the default base maps still draw, but CARTO covers their thumbnails in the picker
  with an "API key required" watermark.
- **A 3D layer** does not draw, and the map says why: the organisation has no key for that service, or the service
  turned the key away when the page loaded. For Google, the notice adds that Google serves no Photorealistic 3D Tiles
  to accounts billed in the European Economic Area.

## Keys are not saved in dashboards

The organisation's keys live only in the app's settings. No Plus panel option holds them, so they are not in a
dashboard's JSON or in an exported dashboard. Changing a key on the configuration page changes it for every
dashboard at once.

Two fields inherited from the free panel can still put a key in a dashboard:

- The panel's own **CARTO API key** option, under **Map**, is saved with the dashboard. Leave it empty and set the
  organisation's **CARTO basemaps API key** instead.
- A 3D tileset added through kepler's own form with a typed token keeps that token in the dashboard, **unless** the
  organisation has a key for that service: then Plus drops the token when the dashboard is saved and draws with the
  organisation's key. Add Google and Cesium ion layers from the **3D (Plus)** tab in **Add Data** instead; see
  [3D tiles](/plus/maps/3d-tiles).
