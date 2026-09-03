# Dashboards kept but not provisioned

Everything under `provisioning-sources/dashboards/` is loaded into the sources bench on startup.
This directory is for dashboards that are worth keeping in the repository but are **not** wired into
provisioning, and there is one reason to prefer it: the provider in
`provisioning-sources/dashboards/default.yaml` does not set `allowUiUpdates`, so a provisioned
dashboard is **read-only in Grafana**. A dashboard still being built has to stay editable, and it
cannot be both.

Import one by hand — **Dashboards → New → Import → Upload JSON file** — or move it into
`provisioning-sources/dashboards/` once it stops changing, accepting the read-only trade.

## `r5-accesibilidad.json`

_Accesibilidad por isocronas (R5 + DuckDB)_ — click a point on the map and every panel re-answers
for it: population, transit stops, parks and area reachable within the cutoff, as isochrones and as
four trends over the clock. Nine panels, one of them this plugin's.

Rescued from the bench's own database on 2026-09-02, where it existed **only** there: created
through the UI rather than provisioned, so a `docker compose down -v` on that container would have
taken it with it.

Three services answer its queries, and only one of them is a problem:

| | |
| --- | --- |
| `https://r5.ubica.ec` | GTFS stops, public |
| `https://appsllactalab.ucuenca.edu.ec` | park access points, GeoServer, public |
| `http://172.22.0.1:8099` | the isochrone service — **on the host, not in this compose file** |

That third one is why the file is a faithful export rather than a portable dashboard. `172.22.0.1`
is the Docker bridge gateway as it happened to be numbered on one machine; Docker is free to
allocate a different one, and the address means nothing on anyone else's. It was hardcoded because
`grafana-sources` was the one bench without a `host.docker.internal` alias — it has one now, so the
nine queries can be moved to `http://host.docker.internal:8099` whenever the dashboard is next
edited, and would then work anywhere the isochrone service is running on the host.

Nothing here runs that service; it is expected on port 8099 of the machine hosting the bench.
