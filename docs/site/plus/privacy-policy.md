# Privacy Policy

::: info
This is the privacy policy of Kepler Geospatial Maps Plus, as shipped inside the plugin as `PRIVACY.md`. The copy
shipped with each version of the plugin describes that version. [Privacy](/plus/admin/privacy) under Administration
has the technical detail, host by host, and [End-User Licence Agreement](/plus/legal) the terms of use.
:::

**Kepler Geospatial Maps Plus** · Version 1.0 · 7 October 2026

This policy explains what Javier Andrés García Galarza, trading as UBICA ("UBICA", "we"), of Cuenca,
Ecuador, does with personal data in connection with Kepler Geospatial Maps Plus (the "Software"), its
documentation site and its support, and what the Software itself does with data. UBICA is the
controller of the personal data described in section 3. Contact: <soporte@ubica.dev>.

## 1. The short version

- The Software runs in your Grafana and in your users' browsers. It sends nothing to UBICA: no
  telemetry, no usage statistics, no error reports, no licence checks. There is no server of UBICA's
  behind it.
- Map tiles are fetched by the browser straight from the map provider whose key you set. That
  provider sees the request, as it would from any website that uses its maps.
- UBICA processes personal data only when you contact us, for support, a security report or a direct
  order, and in the sales reports Grafana Labs sends us for purchases made through the Grafana
  Marketplace.

## 2. What the Software does with data

The technical detail, host by host, is at <https://docs.ubica.dev/plus/admin/privacy>.

2.1 **Your query results** are drawn in the browser from the data sources of your Grafana. They are
never sent to UBICA, nor to any map provider.

2.2 **Keys** of map services are stored in your Grafana, in the Software's settings. The panel reads
them through Grafana's API, which answers every signed-in user of the organisation, and the browser
sends each key to its provider with each request.

2.3 **Map, imagery, terrain and 3D tile requests** go from the browser straight to the provider:
CARTO, MapTiler, Esri, Microsoft Azure Maps, Google (Map Tiles API and Photorealistic 3D Tiles) and
Cesium ion when you set their keys, and OpenFreeMap, CARTO, Mapterhorn and Esri World Imagery, the
free panel's defaults, without a key. Each request carries the key, the IP address of the browser, its
user agent, and the coordinates of the tile, which say what area and zoom level the viewer is looking
at. Requests to Google also carry a session token the browser obtains with the key. Each provider
processes these requests under its own privacy policy (section 11). UBICA receives none of them.

2.4 **Places and IP addresses.** Region codes, airports, country names and IP addresses in your data
are looked up in data files shipped inside the plugin, among them the IP-to-country table from DB-IP.
The browser downloads those files from your Grafana and does the lookup itself. An IP address in your
data is never sent anywhere by the Software.

2.5 **Active alerts** are read through Grafana's own alerting API, as the signed-in user and with that
user's permissions. They do not leave Grafana and the browser.

2.6 **Grafana Assistant.** The Software registers skills, which are instructions, with Grafana
Assistant. What a user says to the Assistant, and what the Assistant reads from the dashboard, is
processed by Grafana Labs under Grafana's terms and privacy policy. Nothing of it reaches UBICA.

2.7 **Your own 3D models.** If you give the Fleet layer the URL of a model, the browser fetches the
model from that URL.

2.8 **Browser storage.** The Software stores nothing in the browser beyond the memory of the open
page. Pinned cards and the followed asset are saved in the dashboard itself, in your Grafana, by the
users allowed to save dashboards.

2.9 **Delivery of the plugin.** On Grafana Cloud, Grafana Labs serves the plugin's files from its
plugin CDN; on Grafana Enterprise, your Grafana serves them. Those requests are made to Grafana Labs or
to your Grafana, not to UBICA.

## 3. What UBICA collects, why, and for how long

3.1 **Support and security reports.** When you write to <soporte@ubica.dev> or through another
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
holds about you, and object to processing based on legitimate interest. Write to <soporte@ubica.dev>;
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

Javier Andrés García Galarza, trading as UBICA · Cuenca, Ecuador · <soporte@ubica.dev> ·
<https://ubica.dev>

## 11. The providers' privacy policies

- CARTO: <https://carto.com/privacy>
- MapTiler: <https://www.maptiler.com/privacy-policy/>
- Esri: <https://www.esri.com/en-us/privacy/overview>
- Microsoft (Azure Maps): <https://privacy.microsoft.com/privacystatement>
- Google (Maps Platform): <https://policies.google.com/privacy>
- Cesium (ion): <https://cesium.com/legal/privacy-policy/>
- OpenFreeMap: <https://openfreemap.org/>
- Mapterhorn: <https://mapterhorn.com/>
- Grafana Labs: <https://grafana.com/legal/privacy-policy/>
- GitHub (the documentation site's host):
  <https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement>
