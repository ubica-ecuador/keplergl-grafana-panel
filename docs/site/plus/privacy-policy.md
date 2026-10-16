# Privacy Policy

::: info
This is the privacy policy of Kepler Geospatial Maps Plus, as shipped inside the plugin as `PRIVACY.md`. The copy
shipped with each version of the plugin describes that version. [Privacy](/plus/admin/privacy) under Administration
has the technical detail, host by host, and [End-User Licence Agreement](/plus/legal) the terms of use.
:::

**Kepler Geospatial Maps Plus** · Version 1.1 · 16 October 2026

This policy explains what Javier Andrés García Galarza, trading as UBICA ("UBICA", "we"), of Cuenca,
Ecuador, does with personal data in connection with Kepler Geospatial Maps Plus (the "Software"), its
documentation site and its support, and what the Software itself does with data. UBICA is the
controller of the personal data described in section 3. Contact: <jgarcia@ubicacuenca.com>.

## 1. The short version

- The Software runs in your Grafana and in your users' browsers. It sends nothing to UBICA: no
  telemetry, no usage statistics, no error reports, no licence checks. There is no server of UBICA's
  behind it.
- Map tiles are fetched by the browser from the map provider whose key you set, straight or, for
  Google and Microsoft Azure Maps, through your own Grafana, which adds the key. That provider sees the
  request, as it would from any website that uses its maps.
- The Time Brush panel remembers each reader's own choices, such as where they left its floating bar,
  in their browser's local storage. They never leave the browser.
- UBICA processes personal data only when you contact us, for support, a security report or a direct
  order, and in the sales reports Grafana Labs sends us for purchases made through the Grafana
  Marketplace.

## 2. What the Software does with data

The technical detail, host by host, is at <https://docs.ubica.dev/plus/admin/privacy>.

2.1 **Your query results** are drawn in the browser from the data sources of your Grafana. They are
never sent to UBICA, nor to any map provider, with one exception that comes from the free panel: when a
row carries the URL of a raster to draw (a cloud-optimised GeoTIFF), the browser sends that URL, with any
signature it carries, to the raster tile server set in the panel's options, which reads the raster on the
map's behalf. No server is set until someone chooses one, and until then no raster is drawn; the panel
says so.

2.2 **Keys** of map services are stored in your Grafana, in the Software's settings. The Google and
Microsoft Azure Maps keys are kept in Grafana's encrypted settings and never reach a browser: Grafana
adds them to the requests it forwards to those providers (section 2.3). The CARTO, MapTiler and Esri
keys are read by the panel through Grafana's API, which answers every signed-in user of the
organisation, and the browser sends each of them to its provider with each request, because those
providers accept a key only in the address of the request.

2.3 **Map, imagery, terrain and 3D tile requests** go from the browser straight to the provider:
CARTO, MapTiler and Esri when you set their keys, and OpenFreeMap, CARTO, Mapterhorn and Esri World
Imagery, the free panel's defaults, without a key. Each request carries the key, the IP address of the
browser, its user agent, and the coordinates of the tile, which say what area and zoom level the viewer
is looking at. Requests to Microsoft Azure Maps and Google (Map Tiles API and Photorealistic 3D Tiles)
go from the browser to your Grafana, which forwards them to the provider with the key. Grafana passes
on the browser's IP address and user agent, the address of the dashboard and the coordinates of the
tile, and the Software has it leave out the headers that would describe the signed-in user. Requests to Google also carry a session token the browser obtains with the key, and the request
that opens that session carries the language and region of the Grafana user, so that Google labels the
map in them. Raster tile requests go to the raster tile server of section 2.1. Each provider processes
these requests under its own privacy policy (section 11). UBICA receives none of them.

2.4 **Cesium ion.** A map can draw a 3D tileset hosted on Cesium ion, run by Cesium GS, Inc., when the
layer carries the access token of a Cesium ion account. The browser then asks Cesium ion's API
(`api.cesium.com`) about the asset, sending the asset's number in the address and the token in the
request's `Authorization` header, and fetches the tiles from the address Cesium ion answers with, using
the credentials it answers with. It also loads Cesium ion's own credit image from
`assets.ion.cesium.com`. Like the requests of section 2.3, each carries the IP address of the browser
and its user agent, and the tile requests say which part of the asset the viewer is looking at. Cesium
GS processes these requests under its own privacy policy (section 11). UBICA receives none of them.

2.5 **Places and IP addresses.** Region codes, airports, country names and IP addresses in your data
are looked up in data files shipped inside the plugin, among them the IP-to-country table from DB-IP.
The browser downloads those files from your Grafana and does the lookup itself. An IP address in your
data is never sent anywhere by the Software.

2.6 **Active alerts** are read through Grafana's own alerting API, as the signed-in user and with that
user's permissions. They do not leave Grafana and the browser.

2.7 **Grafana Assistant.** The Software registers skills, which are instructions, with Grafana
Assistant. What a user says to the Assistant, and what the Assistant reads from the dashboard, is
processed by Grafana Labs under Grafana's terms and privacy policy. Nothing of it reaches UBICA.

2.8 **Your own 3D models.** If you give the Fleet layer the URL of a model, which must be an `https://`
address or a path to the plugin's own files in your Grafana, the browser fetches the model from that URL.

2.9 **Browser storage.** The map panel's own code stores nothing in the browser beyond the memory of
the open page. kepler.gl, which it embeds, keeps one preference in the browser's local storage: the unit
of the map scale, kilometres or miles, which holds no personal data. Pinned cards and the followed asset
are saved in the dashboard itself, in your Grafana, by the users allowed to save dashboards.

The Time Brush panel keeps each reader's own choices in the browser's local storage, per dashboard and
panel, under keys that begin with `ubica-timebrush-panel`: where they left the floating bar (the edge or
corner it sits nearest, its distance from it, its width and the height of its histogram), and the choices
they made in the panel's dock (the bucket size, the value scale, how the series are drawn, when and
where the bar pins, the window mode and the playback speed). These hold no personal data, are never sent
anywhere by the Software, and stay in that browser until the reader resets them in the panel or clears
the browser's site data. A place or choices kept by an earlier version under keys that begin with
`ubica-timebrush:` are moved to the new keys the first time they are read.

2.10 **Delivery of the plugin.** On Grafana Cloud, Grafana Labs serves the plugin's files from its
plugin CDN; on Grafana Enterprise, your Grafana serves them. Those requests are made to Grafana Labs or
to your Grafana, not to UBICA.

## 3. What UBICA collects, why, and for how long

3.1 **Support and security reports.** When you write to <jgarcia@ubicacuenca.com> or through another
support channel, UBICA receives your name, email address and organisation, your Grafana edition and
version, and whatever you send: screenshots, dashboard JSON, logs or query results. Purpose: to provide
the support the licence includes and to fix the Software. Legal basis: the performance of the contract
with you or your organisation, and UBICA's legitimate interest in maintaining the Software. Please
remove from what you send any personal data that is not needed to reproduce the problem. Retention:
for as long as needed to handle the request and to keep a record of the support given, and at most
three years after your subscription ends, unless the law requires longer.

3.2 **Orders through the Grafana Marketplace.** Grafana Labs, or its reseller, is the seller of
record. It processes your account, billing and payment data under its own privacy policy. Grafana Labs
sends UBICA periodic reports on the sales of the Software, which may name the purchasing organisation
and the subscription bought, so that UBICA can provide support and account for the revenue.
Retention: for the life of the subscription and for the time accounting and tax law requires
afterwards.

3.3 **Direct orders.** If you contract with UBICA directly, UBICA collects the contact and billing
data needed for the contract and the invoice: name, organisation, tax identification number, address
and email address. Purpose: to perform the contract, invoice you and comply with Ecuadorian tax law.
Retention: the time tax and accounting law requires, seven years under Ecuadorian tax rules.

3.4 **The documentation site.** <https://docs.ubica.dev> is a static site hosted on GitHub Pages. It
sets no cookies of UBICA's, runs no analytics, and its search runs in the browser. GitHub may log
requests to it under GitHub's privacy statement.

3.5 **Nothing else.** UBICA does not collect personal data through the Software, does not profile
users, does not sell personal data, and does not use it for advertising.

## 4. Who else sees it

- Grafana Labs, as the seller of record of Marketplace orders (section 3.2).
- The providers UBICA uses to run its business, as processors: email, file storage and accounting.
  They process the data only on UBICA's instructions.
- Professional advisers, legal and accounting, under confidentiality.
- Authorities, where the law requires it.

## 5. International transfers

UBICA is in Ecuador, and data you send UBICA is processed there. For data from the European Economic
Area, the United Kingdom or Switzerland, Ecuador has no adequacy decision; the transfer is necessary
for the performance of the contract between you and UBICA (Article 49(1)(b) and (c) GDPR), and on
request UBICA will sign the standard contractual clauses with you.

## 6. Security

UBICA keeps the data it holds in access-controlled accounts, shares it only with those who need it for
the purposes above, and deletes it when it is no longer needed. The Software itself holds no data of
yours (section 2). If a security breach affects your personal data, UBICA will tell you without undue
delay.

## 7. Your rights

Under the laws that apply to you, among them the GDPR and Ecuador's Ley Orgánica de Protección de
Datos Personales, you may ask to access, rectify, erase, restrict or port the personal data UBICA
holds about you, and object to processing based on legitimate interest. Write to <jgarcia@ubicacuenca.com>;
UBICA answers within the time the applicable law sets. You may also complain to your supervisory
authority, which in Ecuador is the Superintendencia de Protección de Datos Personales.

## 8. Children

The Software and the site are meant for organisations and professionals, and are not directed at
children. UBICA does not knowingly collect personal data from children.

## 9. Changes

New versions of this policy are dated and numbered. The version shipped inside the Software, as
`PRIVACY.md`, describes that version of the Software; the current version is published at
<https://docs.ubica.dev/plus/privacy-policy>. Material changes are announced in the changelog.

## 10. Contact

Javier Andrés García Galarza, trading as UBICA · Cuenca, Ecuador · <jgarcia@ubicacuenca.com> ·
<https://ubica.dev>

## 11. The providers' privacy policies

- CARTO: <https://carto.com/privacy>
- MapTiler: <https://www.maptiler.com/privacy-policy/>
- Esri: <https://www.esri.com/en-us/privacy/overview>
- Microsoft (Azure Maps): <https://privacy.microsoft.com/privacystatement>
- Google (Maps Platform): <https://policies.google.com/privacy>
- Cesium GS, Inc. (Cesium ion): <https://cesium.com/legal/privacy-policy/>
- OpenFreeMap: <https://openfreemap.org/>
- Mapterhorn: <https://mapterhorn.com/>
- Grafana Labs: <https://grafana.com/legal/privacy-policy/>
- GitHub (the documentation site's host):
  <https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement>
