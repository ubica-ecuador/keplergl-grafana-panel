# Install and configure the app

Plus is an app plugin, **Kepler Geospatial Maps Plus** (`ubica-keplerplus-app`). The app holds the organisation's
map service keys and the template dashboards, and it brings its own panel, also called **Kepler Geospatial Maps
Plus** (`ubica-keplerplus-panel`). The panel does not need the free panel to be installed, and does not get in its
way when it is.

Plus needs Grafana Cloud or Grafana Enterprise, version 12.0.10 or a later 12.0 patch, 12.1.7 or a later 12.1
patch, or 12.2.5 and later.

## Install and enable the app

1. In Grafana, open **Administration → Plugins and data → Plugins**, search for **Kepler Geospatial Maps Plus** in
   Grafana's plugin catalogue, and install it.
2. On the app's page, choose **Enable**. Enabling the app installs the
   [template dashboards](#the-template-dashboards) and makes the panel available.
3. Open the app's **Configuration** tab and add the keys of the map services you use. Every key is optional.

The panel then appears as **Kepler Geospatial Maps Plus** in the visualization picker of every dashboard in the
organisation.

On a self-managed Grafana Enterprise where you install plugins from the command line, restart Grafana after
installing, as with any plugin.

## The configuration page

The **Configuration** tab has one section, **Map service keys**, with one field per provider and a **Save keys**
button. Saving shows **Keys saved**, or **The keys could not be saved** when Grafana refuses the change; changing
an app's settings needs the organisation's Admin role.

Every key is optional. Without any, Plus draws the free panel's base maps, and every Plus layer, Places, network
links and active alerts work as usual. Each key switches on the services of one provider for every Plus panel in
the organisation:

| Field                        | What it switches on                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CARTO basemaps API key       | The default Dark Matter, Positron and Voyager maps ask CARTO with this key, which keeps CARTO's watermark off them               |
| Mapbox access token          | Nothing in this version: no Plus map uses it, so leave it empty                                                                  |
| MapTiler API key             | MapTiler's base maps, with its 3D buildings, points of interest and Relief switches                                              |
| ArcGIS API key               | Esri's ArcGIS basemap styles, with a Relief switch; it must be an ArcGIS Location Platform key with the basemap styles privilege |
| Google Maps Platform API key | Google's roadmap, satellite, hybrid and terrain maps, and Google Photorealistic 3D Tiles; it needs the Map Tiles API enabled     |
| Cesium ion access token      | Your Cesium ion account's 3D assets, and Cesium OSM Buildings                                                                    |
| Azure Maps subscription key  | Azure Maps' road, dark grey, imagery and hybrid maps, with a Relief switch                                                       |

The keyed base maps then appear in kepler's base map picker, and the 3D services in the **3D (Plus)** tab of
**Add Data**. See [Base maps](/plus/maps/basemaps) and [3D tiles](/plus/maps/3d-tiles) for each provider's styles,
and how to restrict its key.

Under the Google, Cesium ion and Azure Maps fields the page shows a warning with that provider's terms or the limits
of its key. Read them before saving the key: they apply to every map drawn with it.

::: warning Keys are readable by viewers
Each provider expects its key in the browser, so anyone who can open a dashboard in the organisation can read the
keys set here. No dashboard saves them. Restrict each key to your Grafana's address where the provider allows it;
Azure Maps does not. See [Keys and who can read them](/plus/admin/keys).
:::

A Plus panel reads the keys when the page loads. After saving a key, reload the dashboards that are already open.

A map saved on a keyed base map opens on the default style, with a notice, when its key is missing or refused. See
[Move a dashboard to Plus](/plus/start/upgrade-a-dashboard#when-a-key-is-missing).

On a Grafana with a Content Security Policy, the hosts of each provider you enable must be allowed. See
[Content Security Policy](/plus/admin/csp).

## The template dashboards

Enabling the app installs twelve template dashboards, listed on the app's **Dashboards** tab and in
[Template dashboards](/plus/start/templates). Each one has a starting query and a note on what to change to use your
own data.

Grafana manages these dashboards with the app: it may replace them when the app is updated, and removes them when
the app is disabled. To customise one, save a copy first with **Save as**.

The **Dashboards** tab also imports a template again, for instance one that was deleted, or one added by an update
of an app that was already enabled.
