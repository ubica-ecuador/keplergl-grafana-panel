# Dashboards kept but not provisioned

Everything under `provisioning-sources/dashboards/` is loaded into the sources bench on startup.
This directory is for dashboards that are worth keeping in the repository but are **not** wired into
provisioning.

It used to say the reason was that a provisioned dashboard is read-only. That stopped being true the
day after this file was written: `provisioning-sources/dashboards/default.yaml` sets
`allowUiUpdates: true` since `c3b07f2`, so a provisioned dashboard on the sources bench **is**
editable and saveable in the UI. The trade it carries instead is that the file still wins whenever
it changes on disk — edit freely, but export a change worth keeping back over the file, or the next
`git pull` that touches it takes the edits with it.

So what is left here are dashboards that cannot be provisioned for some *other* reason — they point
at services this compose file does not run, or they exist in two variants neither of which is the
canonical one. Import one by hand — **Dashboards → New → Import → Upload JSON file** — or move it
into `provisioning-sources/dashboards/` once it stops changing.

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

## `r5-calles.json`

_Cuenca in 30 minutes — streets by travel time_ — the same R5 travel-time surface, drawn on the
street network instead of on cells. Every street reachable from the white dot takes the minute R5
reaches it, from cyan at the origin to magenta at the cutoff. Additive blending makes the network
glow over a dark base map. Click to move the origin; press play and the city lights up minute by
minute.

The streets are not stored anywhere. They come from Overture Maps' GeoParquet on S3, through three
variables that run once per dashboard load and feed one another:

| variable | what it does | measured |
| --- | --- | --- |
| `ov_release` | reads the latest release from Overture's STAC catalogue | ~0.4 s |
| `ov_url` | finds, in that release's `collections.parquet`, the segment file whose bbox covers the isochrone service's bounds | ~0.6 s |
| `calles` | `CREATE TABLE IF NOT EXISTS "calles_ov_<release>"`: reads that one file with a bbox filter and cuts every road into 50 m pieces | 7–27 s cold, ~3 s once the table exists |

The map query then joins those pieces to `cells.json`. Each piece takes the minute of the R5 cell
under its midpoint, and the join costs milliseconds. A new Overture release gets a new table name,
so nothing goes stale.

Three details break it silently if changed:

- **The file URL is `https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/…`, not `s3://…`.**
  The data source sets no S3 region, and `s3://` resolves to us-east-1 and fails.
- **The file is resolved in a variable, not inline**, because `read_parquet` cannot take a subquery.
  Reading the whole theme with a glob instead costs ~90 s in file footers alone.
- **The map query names `$calles` in a comment.** That is what makes Grafana wait for the table
  before running the query.

**Known weakness: the cold load.** Inside Grafana the S3 read is erratic. On an idle bench it
measured anywhere from 7.6 s to past the query deadline (31–51 s), against 5–9 s for the same
DuckDB version outside Grafana, and the plugin has no timeout to raise. When the read misses, the
map stays empty until a reload. Once the table exists it lives in the data source's memory until
the plugin restarts.

It needs the isochrone service too, so it comes in the same two variants as `r5-accesibilidad`:
`r5-calles-deployed.json` differs only in calling `http://iso-cuenca:8099` where the bench copy
calls `http://host.docker.internal:8099`.

On a laptop, an SSH tunnel to the server's instance does not work: the service publishes no port,
and the server's own host cannot reach the container's address either. Run it locally instead, from
the `app.py` and `Dockerfile` in the server's `apps/iso-cuenca`, against the public R5:

```sh
docker build -t iso-cuenca:local iso-cuenca/
docker run -d --name iso-cuenca-local --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e R5_API=https://r5.ubica.ec -v "$PWD/iso-cuenca/cache:/cache" \
  -p 172.17.0.1:8099:8099 iso-cuenca:local
```

Binding to the Docker bridge address keeps the port off the local network while the bench still
reaches it as `host.docker.internal`. `HOME=/tmp` is there because DuckDB installs its `raster`
extension on first use and needs a writable home.

When checking that the service is reachable, do not use `/health`: it answers HEAD with 405, and
DuckDB, which sends HEAD first, reports that as "HTTP 0", which looks like no connection at all.

## The fire-emissions dashboard is not here, and not in `provisioning-sources/` either

It is worth writing down, because it has now been re-added by mistake once.

The dashboard people mean by "Fire Emissions Watch" is `fire-emissions-tabs`: stored as
`dashboard.grafana.app/v2`, with a `TabsLayout` and fifteen `elements`, and it is the one carrying
the smoke layer. **It cannot travel as a file.** Exporting it through `/api/dashboards/uid` is lossy
and silent — the classic endpoint hands back a v1 conversion of four `row` panels — and provisioning
that conversion back replaces the real thing, tabs and all. Commit `5db517c` reverted exactly that
and took the file out of the repository on purpose.

### Pero un v2 escrito a mano SÍ se provisiona (comprobado 2026-09-09)

Lo de arriba es cierto de **exportar**, y sólo de exportar. Escribir un
`dashboard.grafana.app/v2beta1` a mano en `provisioning/dashboards/` y dejar que
Grafana 13.2.1 lo cargue **funciona**: entra con `provisioned: true`, la API lo
devuelve como v2beta1 con su layout intacto, y un `TabsLayout` se ve con pestañas
en el navegador. Al quitar el fichero, Grafana lo retira solo.

Así lo hace `provisioning-sources/dashboards/enso-ecuador.json`, que es v2beta1
con siete pestañas y sigue versionado como cualquier otro. La receta para
escribirlo sin adivinar la forma: provisionar el v1, pedirlo a
`/apis/dashboard.grafana.app/v2beta1/namespaces/default/dashboards/<uid>` —Grafana
lo traduce— y sustituir el `GridLayout` que devuelve por un `TabsLayout`.

Necesita el toggle `dashboardNewLayouts`, que trae 13.2.1 y no 12.0.10.

### La pestaña Imagery se injerta, no se exporta (2026-09-15)

La quinta pestaña, *Imagery* (pausar el reloj de incendios, dibujar un recuadro y ver las escenas
Sentinel-2 de los días siguientes), no está guardada en ningún fichero de tablero. La construye
`scripts/fire-imagery/build.py` a partir del objeto v2beta1 que devuelve el apiserver:

    python3 scripts/fire-imagery/build.py local prod.json provisioning-sources/dashboards/fire-emissions-tabs-local.json
    python3 scripts/fire-imagery/build.py prod  prod.json grafted.json

`local` produce una copia con uid `fire-emissions-tabs-local` para el banco. Esa copia **no se commitea**:
todo lo que hay en `provisioning-sources/` llega a producción con `git pull`, y aparecería como tablero
duplicado. Va en `.git/info/exclude`. `prod` produce el objeto entero, con su `resourceVersion`, para un
`PUT` al apiserver, que exige token de cuenta de servicio. El script se niega a injertar dos veces y a
pisar claves de elemento, ids de panel o nombres de variable. Los tests están en
`scripts/fire-imagery/test_build.py`, y el SQL de los paneles en `scripts/fire-imagery/sql/`.

There is a second, older dashboard under the uid `fire-emissions`: classic, no tabs, and no smoke
layer. It is not the same dashboard, and shipping it as though it were is the mistake to avoid.

So the fire dashboard lives in the server's database. What the repository carries instead is
everything that dashboard needs and that *can* be versioned: `testdata/make-firedata.py` for its two
fixtures, `docs/fire-emissions-deploy.md` for moving it to another Grafana, and — in the plugin
itself — the JSON colormap support the smoke layer's alpha ramp depends on, plus the patched TiTiler
image under `docker/titiler` without which the ARCO store answers 500 to every tile.
