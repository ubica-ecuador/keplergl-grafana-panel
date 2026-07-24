# Kepler.gl panel for Grafana

Interactive [kepler.gl](https://kepler.gl) maps inside Grafana dashboards, fed by any Grafana data
source. Built for spatio-temporal mobility data — points, trajectories and origin-destination flows.

An open source alternative to the Foursquare Studio panel, which renders its map in an iframe against
`studio.foursquare.com` and therefore needs a Foursquare account. This one runs kepler.gl inside the
panel: no external service, no account, no Mapbox token.

> **Status: v0.1.** Usable, and pinned to a kepler.gl pre-release because the Flow layer exists
> nowhere else. Not yet in the Grafana catalog — see [Roadmap](#roadmap).

## What it does today

- **Any data source.** Each query becomes a kepler dataset, so a single panel can overlay several.
- **Column autodetection**, overridable per query — lat/lng, time, trip id, geometry, H3 and
  origin/destination pairs.
- **PostGIS geometry works out of the box**, including raw `EWKB` hex. `ST_AsGeoJSON` is optional,
  not required.
- **Your layer configuration survives a refresh.** Data is swapped underneath the layers rather than
  the datasets being torn down and rebuilt.
- **Saved map configuration** stored with the dashboard, and configs pasted from kepler.gl,
  Foursquare Studio or Dekart are accepted.
- **Follows the dashboard theme**, base map included.
- **No outbound calls to any vendor.** Base maps come from Carto and can be swapped for a
  self-hosted `style.json`; kepler's icon library ships with the plugin.

## Queries

Nothing special is required — the plugin reads the columns your query already returns. Name them
recognisably and it configures itself; otherwise map them by hand under **Field mapping**.

### Points

```sql
SELECT lat AS latitude,
       lon AS longitude,
       recorded_at,          -- any time column is detected by type
       speed_kmh             -- extra columns become tooltips and colour scales
FROM gps_readings;
```

### PostGIS geometry

The Postgres data source returns geometry as EWKB hex, which the plugin normalises for you:

```sql
SELECT geom, name, category    -- no ST_AsGeoJSON needed
FROM neighbourhoods;
```

`ST_AsGeoJSON(geom)` and WKT work equally well if you prefer them.

### Trajectories

Give each trajectory an id and a time, and map the **Trip ID** role:

```sql
SELECT vehicle_id AS trip_id,
       ST_Y(geom) AS latitude,
       ST_X(geom) AS longitude,
       ts AS time
FROM vehicle_positions
ORDER BY vehicle_id, ts;
```

### Origin-destination flows

The flow layer takes a flat OD table:

```sql
SELECT o.lat AS origin_lat, o.lon AS origin_lon,
       d.lat AS dest_lat,   d.lon AS dest_lon,
       COUNT(*) AS trips
FROM trips t
JOIN zones o ON o.id = t.origin_zone
JOIN zones d ON d.id = t.dest_zone
GROUP BY 1, 2, 3, 4;
```

## Panel options

| Option | Notes |
|---|---|
| **Field mapping** | Per query. Autodetected values appear as placeholders; set one to override. |
| **Show side panel** | kepler's layer and filter panel. Worth hiding on small tiles. |
| **Follow dashboard theme** | Off leaves kepler with its own styling. |
| **Base map** | Carto Dark Matter / Positron / Voyager, or a self-hosted `style.json`. |
| **Map configuration** | Save the current layers and filters with the dashboard, or paste one in. |

Saving is explicit rather than automatic: the configuration is a sizeable blob that lands in the
dashboard JSON, and rewriting it on every pan would churn the dashboard for nothing.

## Installing

Requires **Grafana `>=12.0.10 <12.1 || >=12.1.7 <12.2 || >=12.2.5`**. Those floors are not arbitrary:
Grafana only added `react/jsx-runtime` to its module import map in those patches, and the plugin
fails to load below them.

The plugin is unsigned while it is pre-1.0, so allow it explicitly:

```ini
[plugins]
allow_loading_unsigned_plugins = ubica-keplergl-panel
```

### Hardened Grafana

With `content_security_policy = true` the map loads and its Web Workers start, but `connect-src`
blocks the base map. MapLibre fetches styles, sprites, glyphs and tiles over XHR, so they all fall
under that directive:

```ini
content_security_policy_template = """...connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com ...;"""
```

Or point **Base map** at a `style.json` on your own network and skip this entirely.

## Development

```bash
npm install
npm run dev          # watch build
npm run server       # Grafana 12.0.10 on :3000, plus a strict-CSP one on :3001
npm run test:ci      # unit tests
npm run e2e          # end-to-end against the running Grafana
```

Requires Node 22+. If you have changed your dev Grafana's admin password, pass it through:
`GRAFANA_ADMIN_PASSWORD=… npm run e2e`.

`npm run verify:spike` drives a browser against the provisioned dashboard and reports what actually
reached the map — useful when a change breaks rendering without breaking a test.

> Do not `rm -rf dist` while the dev containers are running: `dist` is bind-mounted, and deleting it
> leaves the containers serving a stale inode. `npm run build` cleans it correctly.

## Roadmap

- **v0.2** — dashboard time range synced both ways with kepler's timeline; automatic trip layers.
- **v0.3** — origin-destination flow layer; map filters driving dashboard variables.
- **v1.0** — move to kepler.gl 3.3.0 stable, sign, and submit to the Grafana catalog.

Design notes and the findings from the feasibility spike are in [`docs/`](docs/).

## Licence

Apache-2.0. Bundles [kepler.gl](https://github.com/keplergl/kepler.gl) (MIT) and
[flowmap.gl](https://github.com/visgl/flowmap.gl) (Apache-2.0).
