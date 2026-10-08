# Support

Plus is supported by UBICA, who build it, for the term of your subscription. Grafana Labs handles the purchase, the
invoice and the renewal of a subscription bought through the Grafana Marketplace; everything about the plugin itself
comes here.

## Where to write

Write to [jgarcia@ubicacuenca.com](mailto:jgarcia@ubicacuenca.com). Response targets are those of your Order; a
subscription bought through the Grafana Marketplace is answered on business days, a private offer as its contract
says.

## What to send with a report

- Your Grafana edition and version (Cloud, or Enterprise with its version), and the Plus version, from
  **Administration → Plugins → Kepler Geospatial Maps Plus**.
- The data source involved and, when it matters, the shape of the query's result: a screenshot of the query's table
  view is usually enough. Remove anything confidential first; what you send is read by a person and kept only to
  handle the report ([privacy policy](/plus/privacy-policy)).
- For a map that does not draw as expected: the panel's JSON (**Panel menu → Inspect → Panel JSON**), a screenshot,
  and what you expected instead.
- For a base map or 3D layer that does not load: the provider, whether its key is restricted to your Grafana's
  address ([Keys and who can read them](/plus/admin/keys)), and any notice the map showed. Never send a key.
- For a blank map on a Grafana with a strict Content Security Policy: the console's blocked-request messages; see
  [Content Security Policy](/plus/admin/csp).

## Security reports

A suspected vulnerability in Plus goes to the same address, with "security" in the subject. Please do not disclose it
publicly until a fixed version is out. Vulnerabilities rated critical are fixed within 7 days and those rated high
within 30 days of UBICA becoming aware of them, as the [licence agreement](/plus/legal) says.

## What support covers

The Plus plugin: its layers, Places, base maps, 3D layers, the template dashboards and its configuration page. It does
not cover Grafana itself, your data sources or the map providers' services, though UBICA will help you tell where a
problem lies. Feature requests are welcome at the same address; the ones that fit the plugin go into its changelog
when they ship.
