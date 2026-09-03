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

### `r5-accesibilidad-deployed.json`

The same dashboard as it runs on the published instance, kept beside the bench copy because the two
differ in the only place that matters and neither is a stale version of the other:

| | bench copy | deployed copy |
| --- | --- | --- |
| isochrones | `http://172.22.0.1:8099` | `http://iso-cuenca:8099` |
| routing | `https://r5.ubica.ec` | `http://r5-gateway` |

On the server both services are containers on a shared Docker network, so the dashboard calls them
by name. On a laptop they are neither: the isochrone service runs on the host and R5 is reached as
the public deployment. Same nine panels, same ten variables, same queries — three URLs apart.

Which is the argument for eventually lifting those hosts into dashboard variables, the way the fire
dashboard keeps its data root in a `firedata` constant. Until then, import whichever matches where
you are.

## The fire-emissions dashboard is not here, and not in `provisioning-sources/` either

It is worth writing down, because it has now been re-added by mistake once.

The dashboard people mean by "Fire Emissions Watch" is `fire-emissions-tabs`: stored as
`dashboard.grafana.app/v2`, with a `TabsLayout` and fifteen `elements`, and it is the one carrying
the smoke layer. **It cannot travel as a file.** Exporting it through `/api/dashboards/uid` is lossy
and silent — the classic endpoint hands back a v1 conversion of four `row` panels — and provisioning
that conversion back replaces the real thing, tabs and all. Commit `5db517c` reverted exactly that
and took the file out of the repository on purpose.

There is a second, older dashboard under the uid `fire-emissions`: classic, no tabs, and no smoke
layer. It is not the same dashboard, and shipping it as though it were is the mistake to avoid.

So the fire dashboard lives in the server's database. What the repository carries instead is
everything that dashboard needs and that *can* be versioned: `testdata/make-firedata.py` for its two
fixtures, `docs/fire-emissions-deploy.md` for moving it to another Grafana, and — in the plugin
itself — the JSON colormap support the smoke layer's alpha ramp depends on, plus the patched TiTiler
image under `docker/titiler` without which the ARCO store answers 500 to every tile.
