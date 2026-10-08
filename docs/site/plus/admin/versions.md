# Versions

## Supported Grafana versions

Plus runs on the same Grafana versions as the free panel:

- Grafana 12.0, from 12.0.10;
- Grafana 12.1, from 12.1.7;
- Grafana 12.2.5 and every later version.

Earlier patches of 12.0, 12.1 and 12.2 are not supported: the plugin fails to load on them. See
[Requirements](/guide/install#requirements) in the free panel's install guide for why those patches.

## The free panel each release is built on

Plus is compiled from the free panel's source, so every feature of the free panel is in it. Each Plus release is
built on a release of the free panel, and its changelog names which one.

| Plus version             | Free panel version | Grafana versions                                                |
| ------------------------ | ------------------ | --------------------------------------------------------------- |
| 1.0.0 (not yet released) | 1.1.0              | 12.0.10 and later 12.0, 12.1.7 and later 12.1, 12.2.5 and later |

The free panel version of a Plus release is fixed when that release is published.

## The changelog

Each release ships its changelog inside the plugin, as `CHANGELOG.md`. It lists what each Plus version adds and
changes, and which free panel version it is built from. Grafana shows it on the plugin's page under
**Administration → Plugins → Kepler Geospatial Maps Plus**.
