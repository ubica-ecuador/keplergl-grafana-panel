# Keys and who can read them

Plus draws base maps and 3D layers from services that each need a key. You set each key once, for the whole
organisation, and every Plus panel in it uses them. This page says where each key goes, who can read it, and how to
limit what a copied key can be used for.

Since Plus 1.3.0 there are two kinds of key. **Server keys** (Google and Azure Maps) are kept in Grafana's encrypted
settings and never reach a browser. **Browser keys** (CARTO, MapTiler and Esri) are read by the browser, because those
providers take a key only in the address the browser asks for.

## Where each key goes

Open **Administration → Plugins → Kepler Geospatial Maps Plus** and its configuration page. Under **Map service
keys** there is one field per provider. Fill in the ones you use and press **Save keys**. Every key is optional:
without any, Plus draws the free panel's base maps.

| Field                            | What it switches on                                                                | Kind        |
| -------------------------------- | ---------------------------------------------------------------------------------- | ----------- |
| **CARTO basemaps API key**       | The default Dark Matter, Positron and Voyager base maps, without CARTO's watermark | Browser key |
| **MapTiler API key**             | MapTiler's base maps, and MapTiler's terrain under their **Relief** switch         | Browser key |
| **ArcGIS API key**               | Esri's ArcGIS basemap styles                                                       | Browser key |
| **Google Maps Platform API key** | Google's base maps and Google Photorealistic 3D Tiles                              | Server key  |
| **Azure Maps subscription key**  | Azure Maps' road, dark grey, imagery and hybrid maps                               | Server key  |

A server key's field shows **configured** once it is saved, never the key itself; **Reset** clears it. A browser
key's field shows the key as it is stored.

Each field's description says what the provider expects of the key. Two are worth knowing before you create one:

- The **ArcGIS API key** must come from an ArcGIS Location Platform account, not from ArcGIS Online, and have the
  basemap styles privilege. Esri keys expire within a year.
- The **Google Maps Platform API key** needs the Map Tiles API enabled. The configuration page also states Google's
  terms, which limit which other maps a Google map may be shown with.

See [Base maps](/plus/maps/basemaps) and [3D tiles](/plus/maps/3d-tiles) for what each provider draws, and
[Install and configure the app](/plus/start/install) for the first set-up.

## Who can read them

### Server keys: no browser

The Google and Azure Maps keys are kept in the app's encrypted settings (`secureJsonData`), which Grafana never sends
to a browser. A map asks Google and Azure Maps for its tiles through Grafana's plugin proxy: the browser sends the
request to your Grafana, at `/api/plugin-proxy/ubica-keplerplus-app/google/…` or `…/azure/…`, and Grafana adds the
key as a request header on its way to the provider. Viewers, and anyone watching the browser's network requests, see
neither key.

The proxy also blanks the headers Grafana would otherwise send the provider about the signed-in user
(`X-Grafana-Context`, `X-Grafana-User`, `X-Grafana-Id`). As a browser asking directly would, Grafana still passes on
the viewer's IP address (`X-Forwarded-For`) and the address of the dashboard (`X-Grafana-Referer`); it removes the
`Referer` and `Origin` headers. Google's 3D tiles and Azure's tiles go through your Grafana server.

### Browser keys: any user who can open a dashboard

CARTO, MapTiler and Esri take a key only as part of the address the browser asks for, and Grafana's plugin proxy for
app plugins can add headers but not address parameters. So these keys stay where the browser can read them: in the
app's settings, which Grafana's API gives to any signed-in user of the organisation, Viewers included, and in the
browser's network requests. MapTiler also writes its key into the style documents it serves.

This is how these providers expect browser keys to be used, and why they let you restrict a key to the site that
uses it. Treat each browser key as public, and restrict it.

## Restrict each key

Restrict every browser key to your Grafana's address, so that a copy of it is refused anywhere else. Where the
provider allows it, also restrict what a key can do and set a quota.

| Provider   | What to restrict                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| CARTO      | Add restrictions to the key in CARTO's dashboard                                                                      |
| MapTiler   | Restrict the key to your Grafana's URL in your MapTiler account                                                       |
| Esri       | Restrict the key to your Grafana's URL                                                                                |
| Google     | Restrict the key to the Map Tiles API and set a daily quota. Website restrictions do not apply: Grafana's server asks |
| Azure Maps | Use a key from an Azure Maps account kept for this Grafana, with a spending cap                                       |

Use the address your users type in their browser. A browser key restricted to another address is refused, and the
map shows a notice saying so; see [While a key is missing or refused](#while-a-key-is-missing-or-refused).

A Google key restricted to websites (HTTP referrers) is refused when Grafana's server asks with it. Restrict it to the
Map Tiles API instead, or to your Grafana server's IP addresses.

### Google

Each map load that draws Google Photorealistic 3D Tiles counts as one 3D session on your Google account, and the
configuration page states Google's free allowance. Read each provider's terms on the configuration page before you
add its key.

## Keys saved by an earlier version

Before 1.3.0, Plus kept every key, Google's and Azure's included, where any signed-in user could read them. After
upgrading, the configuration page fills the Google and Azure Maps fields in from there and says **Move the keys out of
the open settings**. Until you press **Save keys**, the Google and Azure base maps and Google's 3D tiles are not
offered. Saving moves both keys to the encrypted settings and removes them from the open ones. As they were readable
before, consider rotating them.

## Rotating a key

1. Create the new key at the provider, with the same restrictions as the old one.
2. On the configuration page, paste it into its field (for a server key, press **Reset** first) and press **Save
   keys**.
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
  organisation's key. Add Google 3D layers from the **3D (Plus)** tab in **Add Data** instead; see
  [3D tiles](/plus/maps/3d-tiles).
