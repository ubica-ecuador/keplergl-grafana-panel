# Privacy

Plus has no backend and no server of UBICA's behind it. Everything it does happens in the viewer's browser, which
talks to your Grafana and to the map providers whose keys you set. This page says what goes where.

## Map tiles and 3D tiles

Base map and 3D tile requests go from the viewer's browser straight to each provider: CARTO, MapTiler, Esri, Azure
Maps, Google or Cesium ion. Each request carries the organisation's key for that provider, and, like any web
request, the viewer's IP address and the part of the world the map is showing. Each provider handles them under its
own terms and privacy policy.

UBICA receives neither the keys, nor the tiles, nor anything about the map.

Your query results are not sent to any provider. They arrive through the data sources you already configured, and
the panel draws them in the browser. The one exception comes from the free panel: the address of a raster you draw
reaches the tile server you configured; see [Hardened Grafana](/guide/install#hardened-grafana).

See [Keys and who can read them](/plus/admin/keys) for who can see the keys, and
[Content Security Policy](/plus/admin/csp) for the full list of hosts.

## Places and IP addresses

[Places without coordinates](/plus/data/places) looks up region codes, airports, country names and IP addresses
in data files shipped inside the plugin. The browser downloads those files from your Grafana and does the lookup
itself. An IP address in your data is never sent to a lookup service, to UBICA or to anyone else.

## Active alerts

[Active alerts](/plus/data/active-alerts) are read through Grafana's own alerting API, as the signed-in viewer.
Grafana answers with the rules that viewer may read, so a viewer sees on the map only alerts from folders they can
open. The alerts do not leave Grafana and the browser.

## No telemetry

Neither the app nor the panel sends analytics, usage statistics or error reports, to UBICA or to anyone else.

The privacy policy is at [Licence and terms](/plus/legal).
