# Keys and who can read them

Plus draws Google's and Azure Maps' base maps and Google's 3D tiles with keys of the organisation's own. You set
each key once, for the whole organisation, and every Plus panel in it uses them. This page says where each key goes,
who can read it, and how to limit what a copied key can be used for.

Since Plus 1.4.0 there are two keys, Google's and Azure Maps', and both are kept in Grafana's encrypted settings,
where no browser sees them. The MapTiler, CARTO and Esri keys of earlier versions are no longer offered or read; see
[Upgrading from 1.3](#upgrading-from-1-3).

## Where each key goes

Open **Administration → Plugins → Kepler Geospatial Maps Plus** and its configuration page. Under **Map service
keys** there is one field per provider. Fill in the ones you use and press **Save keys**. Both keys are optional:
without any, Plus draws the free panel's base maps.

| Field                            | What it switches on                                   |
| -------------------------------- | ----------------------------------------------------- |
| **Google Maps Platform API key** | Google's base maps and Google Photorealistic 3D Tiles |
| **Azure Maps subscription key**  | Azure Maps' road, dark grey, imagery and hybrid maps  |

A field shows **configured** once its key is saved, never the key itself; **Reset** clears it.

Each field's description says what the provider expects of the key. The **Google Maps Platform API key** needs the
Map Tiles API enabled, and the configuration page also states Google's terms, which limit which other maps a Google
map may be shown with.

See [Base maps](/plus/maps/basemaps) and [3D tiles](/plus/maps/3d-tiles) for what each provider draws, and
[Install and configure the app](/plus/start/install) for the first set-up.

## Who can read them

No browser. The Google and Azure Maps keys are kept in the app's encrypted settings (`secureJsonData`), which Grafana
never sends to a browser. A map asks Google and Azure Maps for its tiles through Grafana's plugin proxy: the browser
sends the request to your Grafana, at `/api/plugin-proxy/ubica-keplerplus-app/google/…` or `…/azure/…`, and Grafana
adds the key as a request header on its way to the provider. Viewers, and anyone watching the browser's network
requests, see neither key.

The proxy also blanks the headers Grafana would otherwise send the provider about the signed-in user
(`X-Grafana-Context`, `X-Grafana-User`, `X-Grafana-Id`). As a browser asking directly would, Grafana still passes on
the viewer's IP address (`X-Forwarded-For`) and the address of the dashboard (`X-Grafana-Referer`); it removes the
`Referer` and `Origin` headers. Google's 3D tiles and Azure's tiles go through your Grafana server.

Plus takes a key only from a provider that accepts it in a request header. CARTO, MapTiler and Esri take a key only
as part of the address the browser asks for, and Grafana's plugin proxy for app plugins can add headers but not
address parameters, so their keys could only be kept where any signed-in user of the organisation, Viewers included,
could read them. That is why Plus no longer takes them.

## Restrict each key

Where the provider allows it, restrict what a key can do and set a quota.

| Provider   | What to restrict                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Google     | Restrict the key to the Map Tiles API and set a daily quota. Website restrictions do not apply: Grafana's server asks |
| Azure Maps | Use a key from an Azure Maps account kept for this Grafana, with a spending cap                                       |

A Google key restricted to websites (HTTP referrers) is refused when Grafana's server asks with it. Restrict it to the
Map Tiles API instead, or to your Grafana server's IP addresses. A key the provider refuses does not stop the map
from drawing; see [While a key is missing or refused](#while-a-key-is-missing-or-refused).

### Google

Each map load that draws Google Photorealistic 3D Tiles counts as one 3D session on your Google account, and the
configuration page states Google's free allowance. Read each provider's terms on the configuration page before you
add its key.

## Upgrading from 1.3

Plus 1.3 also took MapTiler, CARTO and Esri keys, and kept them in the app's open settings, where any signed-in user
of the organisation could read them. Plus 1.4.0 no longer offers or reads them, and MapTiler's and Esri's keyed base
maps went with them. The Google and Azure Maps keys stay as they were.

### The retired keys

When 1.3 left any of those keys in the settings, the configuration page says **Remove the keys this version no longer
uses** and names them. Press **Save keys**: saving the page removes them from the settings. Then revoke each one in
its provider's account, since every signed-in user could read it until then.

### The retired base maps

These base maps are no longer offered:

| Provider | Styles                                                                                      | Ids               |
| -------- | ------------------------------------------------------------------------------------------- | ----------------- |
| MapTiler | Streets, Streets Dark, Outdoor, Topo, Winter, Dataviz, Dataviz Dark, Satellite, Hybrid      | `plus-maptiler-*` |
| Esri     | Navigation, Navigation Night, Streets, Topographic, Outdoor, Light Gray, Dark Gray, Imagery | `plus-esri-*`     |

A map saved on one of them opens on the free default base map, with a notice such as: _Kepler Geospatial Maps Plus
no longer offers MapTiler base maps, whose key every viewer could read. Showing … instead. Pick another base map and
save the map to keep it._ The data and the layers are drawn as usual.

What is left to pick from:

- **Esri's imagery** is still there as the free panel's **Satellite (Esri)**, which needs no key, and under
  **Satellite + relief**; Esri's topographic map is under **Topographic + relief**.
- **Street and dark maps**: the free panel's OpenFreeMap styles, which need no key; Liberty draws its own 3D
  buildings. Or Azure Maps Road and Dark Grey, or Google Roadmap.
- **Relief**: the **Relief** switch is offered on Azure Maps' styles, and the free panel's **Satellite + relief**
  and **Topographic + relief** draw relief of their own. See [Base maps](/plus/maps/basemaps#relief).

### CARTO without a key

CARTO's Dark Matter, Positron and Voyager stay, asked without a key, as the free panel asks for them when its own
**CARTO API key** option is empty. Plus does not offer that option either; see
[CARTO without a key](/plus/maps/basemaps#carto-without-a-key) on the Base maps page.

## Upgrading from 1.2 or earlier

Before 1.3.0, Plus kept every key, Google's and Azure's included, where any signed-in user could read them. After
upgrading, the configuration page fills the Google and Azure Maps fields in from there and says **Move the keys out of
the open settings**. Until you press **Save keys**, the Google and Azure base maps and Google's 3D tiles are not
offered. Saving moves both keys to the encrypted settings and removes them, and any CARTO, MapTiler or Esri key, from
the open ones. As they were readable before, consider rotating them.

## Rotating a key

1. Create the new key at the provider, with the same restrictions as the old one.
2. On the configuration page, press **Reset** on its field, paste the new key and press **Save keys**.
3. Revoke the old key at the provider.

A dashboard checks the keys once, when the page loads. A dashboard that was already open can stop loading new
tiles once the old key is revoked, until the page is reloaded.

## While a key is missing or refused

A missing or refused key never stops a map from drawing. What a viewer sees instead:

- **The base map picker** lists a provider's base maps only once its key is set.
- **A map saved on a keyed base map, with no key set,** opens on the default base map, with a notice such as: _The
  base map "…" needs a Google key, and this organisation has none. Showing … instead. An administrator can add the
  key on the configuration page of Kepler Geospatial Maps Plus._
- **A key the provider refuses**, because it expired, was revoked or is restricted so that Grafana's server cannot use
  it: the map opens on the default base map, with a notice such as: _Azure Maps did not serve the base map "…". Its
  key may have expired, been revoked, or be restricted to other sites. Showing … instead._
- **A map saved on a MapTiler or Esri style**: see [The retired base maps](#the-retired-base-maps). No key brings
  those back.
- **A 3D layer** does not draw, and the map says why: the organisation has no key for that service, or the service
  turned the key away when the page loaded. For Google, the notice adds that Google serves no Photorealistic 3D Tiles
  to accounts billed in the European Economic Area.

## Keys are not saved in dashboards

The organisation's keys live only in the app's settings. No Plus panel option holds them, so they are not in a
dashboard's JSON or in an exported dashboard. Changing a key on the configuration page changes it for every
dashboard at once.

The free panel's own **CARTO API key** option, which saves its key with the dashboard, is not offered in Plus: the
Plus editor leaves it out, a key a dashboard still carries (saved by the free panel or by an earlier Plus) is never
used, and the next save of the dashboard drops it.

One field inherited from kepler can still put a token in a dashboard: a 3D tileset added through kepler's own form
with a typed token keeps that token in the dashboard, **unless** the organisation has a key for that service: then
Plus drops the token when the dashboard is saved and draws with the organisation's key. Add Google 3D layers from the
**3D (Plus)** tab in **Add Data** instead; see [3D tiles](/plus/maps/3d-tiles).
