# Provisioned test environment

Everything in this folder is loaded automatically by the Grafana containers in
`docker-compose.yaml`. It exists so that anyone — a reviewer, a contributor, or you a month
from now — gets a bench with the panel working without configuring anything by hand.

## One command

```bash
docker compose up grafana
```

Then open <http://localhost:3000>. Anonymous access is enabled with the Admin role, so there
is **no login**. The first run builds the plugin inside a container (a few minutes, once);
after that it starts in seconds.

Nothing else has to be installed. The only provisioned data source is **TestData DB**, which
ships with Grafana, and every dashboard below is fed from it — the panel reads data frames, so
synthetic rows exercise it exactly as a real database would.

The other benches in the compose file are for development, not for review: `:3001` is the same
Grafana under a strict Content-Security-Policy, `:3002` adds the DuckDB and Infinity data
sources for boards that read real remote files, and `:3003` is Grafana 13, the top of the
supported range.

## What each dashboard shows

Eight of these draw as soon as the bench is up. Five are end-to-end test fixtures that point at
hosts which do not resolve; they are listed last and their titles say so.

| Dashboard | Shows |
| --- | --- |
| **Kepler.gl layer gallery** | Every layer type the panel builds from query columns, each next to the rows behind it. Open at most two rows at a time: each map holds two WebGL contexts. |
| **Kepler.gl spike** | Two panels on one dashboard: an animated Trip layer, and geometry arriving as raw EWKB hex — a `SELECT geom` from PostGIS with nothing wrapped around it. |
| **Kepler.gl flows** | Origin-destination flows built from two coordinate pairs per row. |
| **Kepler.gl flow field** | A velocity field traced into streamlines from a grid of speed and direction, with its own panel of options. |
| **Kepler.gl time sync** | The dashboard's time range driving the map's time filter, in the three available modes. |
| **Kepler.gl time variables** | The reverse direction: the map's own time slider publishing its window into two dashboard variables. |
| **Kepler.gl cross-filter** | All five cross-filtering channels at once — filter, click, coordinate, drawn area and viewport — each writing to a dashboard variable, with a text panel showing what the map has published. |
| **Kepler.gl — temporal WMS** | A time-aware WMS drawn from a single row. **Needs internet**: it reads its dates from the live GetCapabilities of `services.geoglows.org`. |

### End-to-end test fixtures

These five point at `titiler.test`, `example.test` and `imagery.test` — hosts that deliberately
do not resolve. They exist so the Playwright suite can intercept their requests and assert on
what the panel asked for. **Opened by hand the map stays empty, and that is the correct
behaviour**, not a defect. Each one repeats this in a banner at the top.

| Dashboard | Pins down |
| --- | --- |
| **Zarr tiles via TiTiler** | A Zarr store drawn through a tile server's `/zarr` router, with the date travelling in the `sel` parameter. |
| **Zarr pyramid and months** | A `multiscales` pyramid where the zoom picks the level and the clock picks a month held as an integer, not a date. |
| **COG painted by TiTiler** | A classified raster painted server-side, which is the only way to keep the colours of a land-cover product. |
| **ArcGIS Image Service by tiles** | An ImageServer asked to draw each tile by extent, with `png32` so nodata arrives transparent. |
| **ArcGIS Image Service over time** | The mosaic rule — which picks the year — driven by the map's clock without rebuilding the layer. |

Boards running against the *real* versions of those services live on the sources bench
(`docker compose up grafana-sources`, port 3002), which installs the DuckDB and Infinity data
sources it needs.

## Requirements

The panel draws through deck.gl and needs **WebGL 2**; there is no canvas or SVG fallback. Each
map holds two WebGL contexts, so a page with many maps on it will exhaust the browser's budget
— the practical ceiling is around eight.

## Files

- `datasources/datasources.yml` — the TestData DB data source, marked as default.
- `dashboards/default.yaml` — the provider that loads every `.json` beside it.
- `dashboards/*.json` — the boards in the tables above. The Playwright suite loads them by file
  name, so renaming a file breaks a test; renaming a dashboard's *title* is safe.

For the mechanics of Grafana provisioning, see
[Provision dashboards and data sources](https://grafana.com/tutorials/provision-dashboards-and-data-sources/).
