# Support and services

The plugin is free and open source under Apache-2.0. Every feature it has is in the
[public repository](https://github.com/ubica-ecuador/keplergl-grafana-panel) and available to
everyone — including the features an organisation paid to have built.

What [UBICA](https://ubica.dev), who maintain it, offer on top is time and guarantees: someone to
answer when a dashboard your operation depends on stops drawing, features built on your timeline,
and dashboards built for your data.

## Support for production use

For organisations running the panel in dashboards they depend on:

- **Priority answers** to questions and bug reports.
- **Help with your install** — a query whose rows do not become the map you expected, a Content
  Security Policy that blanks the base maps, an air-gapped Grafana that needs its own style and
  tile servers (see [Install → Hardened Grafana](./guide/install#hardened-grafana)).
- **Upgrades checked ahead of time.** Grafana and kepler.gl both move quickly; your Grafana version
  and your dashboards are tested before you upgrade, not after.
- **Security fixes on a written schedule**, with response times agreed in the contract.
- **The paperwork procurement asks for**: an inventory of the licences of everything the plugin
  bundles, a software bill of materials, and answers to your security questionnaire.

## Sponsored features

If the panel is missing something you need, you can fund it. It is designed with you, built in the
open and released in the plugin for everyone, under the same licence. What you get is the feature
when you need it, shaped by your use case, rather than whenever it reaches the top of the queue.

This is where the **Sponsor this developer** link on the Grafana catalogue page leads: sponsoring
here means funding work on the plugin.

## Dashboards and implementation

We design and build spatio-temporal dashboards on your own data sources — PostGIS, DuckDB over
GeoParquet, STAC catalogues, cloud-optimised rasters, Zarr stores and WMS services — and deploy them
on your Grafana, hardened and air-gapped installs included. The
[live demos](https://grafana.ubica.ec/dashboards) are examples of that work.

## Training

Workshops for teams adopting the panel: from getting a first query onto the map to trajectories,
flows, imagery over time and cross-filtered dashboards — on your data rather than ours.

## Getting in touch

Write to UBICA on [LinkedIn](https://www.linkedin.com/company/ubica-geospatial) with your Grafana
edition and version (Cloud, Enterprise or OSS), the data sources involved and what you need.

For bugs and questions that are not urgent,
[open an issue on GitHub](https://github.com/ubica-ecuador/keplergl-grafana-panel/issues). Issues
are public and answered as time allows, with or without a support contract.

## Other ways to help

Star the repository, report bugs with a way to reproduce them, and tell us what you built with the
panel. The last one matters most: the plugin sends no telemetry, so a message is the only way we
learn who uses it and for what.
