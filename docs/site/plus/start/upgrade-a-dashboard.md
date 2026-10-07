# Move a dashboard to Plus

A dashboard built with the free panel moves to Plus one panel at a time, by changing its visualization. Nothing has
to be rebuilt.

## Switch a panel

1. Open the dashboard and edit the map panel.
2. In the visualization picker, choose **Kepler Geospatial Maps Plus**.
3. Save the dashboard.

The panel keeps all its options and its saved map: layers, filters, base map, map position and time settings, and
the variables it reads and writes. Plus has the same options under the same paths, so nothing needs converting.
Only options carried over from the free panel are kept; switching from any other visualization, such as Geomap,
starts the Plus panel from its defaults.

Once switched, the panel shows the Plus settings as well: the **Places** and **Active alerts** groups in the panel
options, the [Plus layer types](/plus/layers/) in kepler's layer list, the [Plus base maps](/plus/maps/basemaps) in
kepler's base map picker, and the **3D (Plus)** tab in **Add Data**.

[Places](/plus/data/places) does not change a query the free panel could already draw: one with coordinates, a
geometry, an H3 index or a field mapping is drawn as it was.

## Free and Plus side by side

The free panel and Plus can be installed on the same Grafana, and both panels can sit on the same dashboard. Each
panel keeps its own visualization, so you can move the maps that need Plus and leave the others on the free panel.

## When a key is missing

A Plus map saved on a keyed base map, such as a MapTiler or Google style, needs that provider's key on the
organisation that opens it. When the key is missing or the provider refuses it, the map does not go blank: it draws
the free panel's default base map for the dashboard's theme, OpenFreeMap's Positron or Dark, and shows a notice,
such as:

> The base map “MapTiler Streets” needs a MapTiler key, and this organisation has none. Showing Positron
> (OpenFreeMap) instead.
> An administrator can add the key on the configuration page of Kepler Geospatial Maps Plus.

Other notices say that the provider did not serve the map (its key may have expired, been revoked, or be restricted
to other sites), that it did not answer, or that it does not serve that style to the organisation's account. The
data and the layers are drawn as usual in every case.

To bring the base map back, an administrator adds or replaces the key on the app's
[configuration page](/plus/start/install#the-configuration-page); viewers then reload the dashboard.

## Going back to the free panel

Plus layers, Places, network links and active alerts exist only in the Plus panel. To return a panel to the free
panel, restore the dashboard version saved before the switch, from the dashboard's **Settings → Versions**.
