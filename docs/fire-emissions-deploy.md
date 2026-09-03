# Moving the fire-emissions dashboard to another Grafana

The dashboard in `provisioning-sources/dashboards/fire-emissions.json` is built on the sources
bench (`:3002`, Grafana 12.0.10). Everything it needs travels in that one file **except** three
plugins, one data source, one 8 MB directory and outbound network access. This is the checklist.

Nothing here is specific to a particular Grafana version: the dashboard loads on 12.0.10 and, since
the panel declares `grafanaDependency: >=12.2.5` with no upper bound, on 13.x too. Grafana 13 is
also where the *show/hide rules* live, which is the one thing the bench cannot do — see the last
section.

## 1. Plugins the target must have

| Plugin | Why | Note |
| --- | --- | --- |
| `ubica-keplergl-panel` | the three maps | **unsigned** — see below |
| `motherduck-duckdb-datasource` | every query | Go binary linked against **glibc**: it does not load on Alpine images, use an `-ubuntu` tag |
| `volkovlabs-variable-panel` | the threshold slider | on 12.0.x pin `5.1.1`; from 12.3 up take the latest |

The other panel types — `table`, `timeseries`, `barchart`, `trend`, `stat`, `text`, `row` — are
core.

Our panel ships unsigned until 1.0, so the target needs it allow-listed:

```ini
[plugins]
allow_loading_unsigned_plugins = ubica-keplergl-panel,motherduck-duckdb-datasource
```

or the equivalent env var, `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`. Install it by copying the
built `dist/` into `<plugins dir>/ubica-keplergl-panel` — `npm run build` produces it.

## 2. The data source

The dashboard refers to the data source by **uid `duckdb`**, so create it with exactly that uid and
nothing needs editing on import:

```yaml
apiVersion: 1
datasources:
  - name: DuckDB
    type: motherduck-duckdb-datasource
    uid: duckdb
    jsonData:
      path: ''
      # spatial: ST_GeomFromText / ST_MakeValid / ST_AsHEXWKB, used by the cell
      # polygons and the subdivision outlines.
      # httpfs: read_parquet() against an https:// URL, which is how every live
      # panel reads ECMWF. INSTALL reaches the extension repository the first
      # time, so the first query needs outbound internet; LOAD alone afterwards.
      initSql: 'INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;'
```

If you must use a different uid, import through **Dashboards → Import** and remap it in the dialog.

## 3. The converted series (8 MB)

Two panels — *Cumulative totals by year* and *Totals for the same window* — read Parquet from disk
rather than from ECMWF, because CAMS publishes its per-country daily series as Arrow IPC inside gzip
and DuckDB cannot read that over HTTP. Generate the files and put them where the **Grafana server**
can read them:

```bash
python3 testdata/make-firedata.py      # writes testdata/fire/{cfire,frpfire}_admin0.parquet
```

The path is a dashboard variable, `firedata`, defaulting to `/testdata/fire` — the mount the bench
uses. On the target set it to wherever you put the directory: **Dashboard settings → Variables →
firedata**. It is the only value that has to change.

Everything else on the dashboard is fetched live, so this is the only local state.

## 4. Network the server needs to reach

Server-side, from the Grafana host (the DuckDB data source runs in the backend, so this is not a
browser concern):

- `sites.ecmwf.int` — the GFAS pixels, region index, summary and daily stats
- `apps.atmosphere.copernicus.eu` — the admin0/admin1 areas and geometries
- DuckDB's extension repository, on first query only

Browser-side, the map tiles. If the target runs a hardened Content-Security-Policy, `connect-src`
needs the basemap hosts — maplibre fetches styles, sprites, glyphs and tiles over XHR, so they fall
under `connect-src`, not `img-src`:

```
https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com
https://services.arcgisonline.com https://tiles.mapterhorn.com
```

## 5. Import

Either provision the file (drop it in the dashboards provider directory) or import it by hand:
**Dashboards → New → Import → Upload JSON file**. The uid is `fire-emissions`.

If you provision it, remember that a provisioned dashboard is read-only unless the provider sets
`allowUiUpdates: true` — and that with that flag, edits made in the UI live in Grafana's own
database while the file still wins on the next reload.

## 6. What Grafana 13 adds

The country view is always present, and its panels fall back to the world when no country is
selected, because Grafana 12.0.10 cannot hide a panel conditionally: `repeat` over an empty variable
still renders one placeholder instance, and the show/hide rules were behind an experimental toggle.

Grafana 13 has those rules generally available, and their conditions can key off **variable values**
— which is exactly what `$country_sel` is. On 13 you can therefore hide *Daily playback* and
*Emissions relief* while a country is selected, and hide the whole country row while it is not.

Not verified here: this repo's bench runs 12.0.10 on purpose — it is the floor of the range the
plugin supports and the instance that catches "works on my machine". The plugin has never been
exercised on 13.
