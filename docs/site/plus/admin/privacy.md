# Privacy

Plus has no backend and no server of UBICA's behind it. Everything it does happens in the viewer's browser, which
talks to your Grafana and to the free panel's map providers, and in Grafana's own plugin proxy, which forwards
requests to Google and Azure Maps with their keys. This page says what goes where.

## Map tiles and 3D tiles

Base map requests for the free panel's styles, to OpenFreeMap, CARTO, Esri's public imagery and Mapterhorn, go from
the viewer's browser straight to each provider, with no key. Like any web request, each carries the viewer's IP
address and the part of the world the map is showing. No request from the browser carries one of the
organisation's keys.

Base map and 3D tile requests to Google and Azure Maps go from the viewer's browser to your Grafana, at
`/api/plugin-proxy/ubica-keplerplus-app/…`, and Grafana forwards them to the provider with the key, which never
reaches the browser. Grafana passes on the viewer's IP address (`X-Forwarded-For`), the address of the dashboard
(`X-Grafana-Referer`) and the part of the world the map is showing, and drops the `Referer`, `Origin` and cookie
headers. Plus has it blank the headers that would describe the signed-in user (`X-Grafana-Context`, `X-Grafana-User`,
`X-Grafana-Id`).

Each provider handles these requests under its own terms and privacy policy.

UBICA receives neither the keys, nor the tiles, nor anything about the map.

Your query results are not sent to any provider. They arrive through the data sources you already configured, and
the panel draws them in the browser. The one exception comes from the free panel: the address of a raster you draw,
with any signature it carries, reaches the raster tile server set in the panel's options. No server is set until
someone chooses one; see [Hardened Grafana](/guide/install#hardened-grafana). The request that opens a Google session also carries the
Grafana user's language and region, so Google labels the map in them.

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

The [privacy policy](/plus/privacy-policy) itself says who the controller is, what UBICA keeps about you and your
rights, and the [End-User Licence Agreement](/plus/legal) the terms of use.
