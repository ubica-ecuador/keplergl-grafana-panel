# Geofence alerts

::: info Since Plus 1.6.0
Entity label, Zones and Zone label are new in Plus 1.6.0.
:::

A geofence alert fires while a moving thing (a vehicle, a vessel, an animal) is inside an area, or outside it. The
rule lives in Grafana Alerting, like any other: it runs on the server, whether or not anyone is looking, and
notifies through your contact points. The Plus map shows the result:

- **each alert on the thing it is about**, following it as it moves;
- **each area coloured by what is inside it**: red while one of its alerts fires, amber while one is pending, blue
  when it is quiet.

[![Baltic cable watch: ships over the cables and pipelines of the Baltic, the fences of two of them red with the ships anchored over them, filters on the left, the alerts in a table on the right](/img/plus/geofence-cable-watch.jpg)](https://pacha.ubica.dev/d/baltic-cable-watch)

[Open this dashboard live →](https://pacha.ubica.dev/d/baltic-cable-watch)

_Baltic cable watch: every ship Finland's AIS network hears, the undersea cables and pipelines with a fence around
each, and an alert for every cargo ship or tanker that stops over one. The example is explained
[below](#example-baltic-cable-watch)._

## How it works

1. **A rule finds the things inside a fence.** Its query returns one row per thing (and per fence, when there are
   several), with the thing's id in a text column. Grafana makes one alert instance per row, labelled by the text
   columns. See [Writing the rule](#writing-the-rule).
2. **Plus reads the alerts.** The panel's **Active alerts** layer reads the firing and pending alerts the viewer may
   see, every minute and whenever the panel's data refreshes (see
   [Active alerts](/plus/data/active-alerts#when-alerts-are-read)).
3. **Each alert is drawn on its thing.** The alert names the thing in a label (`vehicle_id=bus-1`); the panel's own
   query has the same id in a column, with the thing's position. The alert goes where the newest row of that id is.
4. **Each fence is drawn as a zone.** From the rule's `geofence` annotation, or from a query of the map (fences kept
   in a database), coloured by the alerts that name it.

The map needs no query of its own for the alerts: only the things (and, if you keep them in a database, the fences).

## Set up the map

Open the panel's options, **Active alerts** category, and turn on **Show active alerts**. Then:

| Option            | What it does                                                                                   | Example               |
| ----------------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| **Label filter**  | keeps the geofence rule's alerts only, by a label of the rule                                  | `watch=baltic-cables` |
| **Entity label**  | the label that names the thing: each alert is drawn on it                                      | `vehicle_id`          |
| **Entity column** | the column of the panel's data that holds the same ids; empty, the column named as the label   | `vehicle`             |
| **Zones**         | draws the zones                                                                                | on                    |
| **Zone label**    | the label that names the fence: each zone takes the state of its own alerts                    | `fence`               |
| **Zone column**   | the column of the fences query that holds the same names; empty, the column named as the label | `name`                |

In the panel's JSON, the same options:

```json
"alerts": {
  "show": true,
  "filter": "watch=baltic-cables",
  "entityLabel": "mmsi",
  "entityField": "mmsi",
  "zones": true,
  "zoneLabel": "cable",
  "zoneField": "cable"
}
```

The status line under the options counts them: `9 alerts · 9 placed by mmsi · 45 zones`.

### The alert, on the entity it names

An instance of a geofence rule names its entity in a label; it cannot carry the entity's coordinates, since a new
position would make a new instance. With **Entity label** set, each alert is drawn at its entity's latest position in
the panel's own data: the row with the newest time, or the last row when the query has no time. It is placed again on
every refresh of the panel's data, so it follows the entity between reads of the rules.

An alert whose entity is not in the panel's data (filtered out, or not heard lately) is counted as
`without a place` in the map's corner.

::: tip Label names
A label named like a column of the alerts layer (`state`, `since`…) or like a role the map recognises
(`vehicle_id`, `latitude`…) is shown as `label_<name>`, so the alerts layer is never read as a fleet or a track. Name
the entity column of your query something else (`vehicle`, not `vehicle_id`), and point **Entity column** at it.
:::

### The zones

**From the rule.** Put the fence in an annotation named `geofence` on the rule, as GeoJSON (a geometry, a Feature or
a FeatureCollection) or as WKT. Each rule with one has its zone drawn under the map's other layers, whatever the
state of its instances:

| Zone  | When                                       |
| ----- | ------------------------------------------ |
| red   | at least one of its alerts is firing       |
| amber | none is firing and at least one is pending |
| blue  | none is active                             |

The zones follow **Label filter** and **Folders**, matched on the rule's own labels, and not **States**. Their
tooltip shows `zone`, `alertname`, `state`, how many alerts are `firing` and `pending`, and `rule_url`. A zone that
is neither GeoJSON nor WKT is named in the map's corner. Turn **Zones** off to hide them.

**One zone per fence.** A rule can watch many fences at once, with one instance per entity and fence, labelled
`vehicle_id` and `fence`. Set **Zone label** to `fence`, and each zone takes the state of the alerts that name it,
rather than of its whole rule:

- a feature of the rule's `geofence` FeatureCollection is named by its property called as the zone label, or else
  `name`;
- every row of the panel's own data that has a geometry and the **Zone column** is drawn as a zone too. That is the
  way for fences kept in a database: query them in the map (geometry as WKB, WKT or GeoJSON, as PostGIS returns it),
  and nothing is copied into the rule. On a new map, the fences query's own layer is switched off, so the fences are
  not drawn twice; on a saved map, hide its layer yourself.

### Your own look

The alerts and zones layers are added by Plus when no layer of the map draws them. To give them your own look, save
a layer for each in the map's configuration: a point layer on the dataset `grafana-ALERTS` and a polygon layer on
`grafana-ALERT_ZONES`, both coloured by `state`. Plus then keeps yours: a quiet zone can be barely there, the alert
translucent so the thing shows through it, and the tooltip can show the labels you need.

## Writing the rule

Create an alert rule whose query returns, for every entity inside a fence, one row with the entity's id (and the
fence's name, for many fences) as text, and a number that is not 0. Grafana makes one alert instance per row,
labelled by the text columns. Set **Pending period** to how long an entity must stay before the alert fires: the
alert is pending (amber) meanwhile.

**With a spatial database** such as PostGIS, the query does the test:

```sql
SELECT v.vehicle_id, f.name AS fence, 1 AS inside
FROM vehicle_positions v
JOIN fences f ON ST_Within(v.geom, f.geom)
```

The same with DuckDB's `spatial` extension (`ST_Contains(f.geom, ST_Point(lon, lat))`), BigQuery GIS, Snowflake or
SQL Server's geography types.

**With any other data source** (TestData, Infinity, MySQL, Elasticsearch…), let the query return the positions
(`vehicle_id`, `lat`, `lon`) and add a **SQL expression** that tests each row against the polygon's edges; spatial
functions are not allowed in SQL expressions, so the test is written by hand (ray casting: a point is inside when a
ray from it crosses the edges an odd number of times). Use the SQL expression itself as the rule's condition:

```sql
WITH e AS (
  -- One row per edge: (x1, y1) to (x2, y2), longitude and latitude, the last back to the first.
  SELECT -79.05 AS x1, -2.95 AS y1, -78.95 AS x2, -2.95 AS y2 UNION ALL
  SELECT -78.95, -2.95, -78.95, -2.85 UNION ALL
  SELECT -78.95, -2.85, -79.05, -2.85 UNION ALL
  SELECT -79.05, -2.85, -79.05, -2.95
)
SELECT A.vehicle_id AS vehicle_id,
  MOD(SUM(CASE WHEN (e.y1 > A.lat) <> (e.y2 > A.lat)
    AND A.lon < (e.x2 - e.x1) * (A.lat - e.y1) / (e.y2 - e.y1) + e.x1 THEN 1 ELSE 0 END), 2) AS inside
FROM A CROSS JOIN e
GROUP BY A.vehicle_id
```

Any polygon works, concave ones included; for one with holes or several parts, list the edges of every ring. For
many fences, add a `fence` column to the edges and group by it too. The cost grows with the number of entities times
the number of edges: past a few thousand of each, test in the database instead. The test treats degrees as flat,
which is right for a city or a region, not for a zone across the antimeridian.

When the query already does the test (PostGIS, DuckDB), a SQL expression can also be the condition that turns its
table into alerts: one that selects the label columns and a `1`. Baltic cable watch does this.

### As a file

A rule can travel with the dashboard as a provisioning file, in Grafana's `provisioning/alerting/` folder:

```yaml
apiVersion: 1
groups:
  - orgId: 1
    name: Geofences
    folder: Alerts
    interval: 1m
    rules:
      - uid: vehicles-in-zones
        title: Vehicle inside a zone
        condition: B
        for: 5m
        noDataState: OK
        execErrState: KeepLast
        labels: { watch: fleet }
        annotations: { summary: '{{ $labels.vehicle_id }} is inside {{ $labels.fence }}' }
        data:
          - refId: A
            datasourceUid: my-postgis
            relativeTimeRange: { from: 600, to: 0 }
            model: { refId: A, format: table, rawSql: '...the query above...' }
          - refId: B
            datasourceUid: __expr__
            model:
              refId: B
              type: sql
              format: alerting
              expression: SELECT vehicle_id, fence, 1 AS inside FROM A
```

A SQL expression written outside the rule editor (a file, the provisioning API) needs `format: alerting`; the editor
sets it for you. `noDataState: OK` keeps an empty result (nobody inside) from being an alert of its own. Reload the
file with `POST /api/admin/provisioning/alerting/reload`, or restart Grafana.

A state is as fresh as the rule's last evaluation: with the rule evaluated every minute, an entity that has just left
a zone may stay red for up to a minute.

## Example: Baltic cable watch

Since 2023, anchors dragged along the floor of the Baltic have cut cables and a gas pipeline. The
[Baltic cable watch](https://pacha.ubica.dev/d/baltic-cable-watch) dashboard watches for that signature, live, on
the open data of Finland's traffic agency. Its files are in the
[pacha repository](https://github.com/ubica-ecuador/pacha): the dashboard
`plus/dashboards/baltic-cable-watch.json`, the rule `provisioning/alerting/baltic-cable-watch.yaml`, and the cables
`datasets/baltic-cables/`.

**The things**: every ship [Digitraffic](https://www.digitraffic.fi/en/marine-traffic/)'s AIS stations hear, with its
latest position, name and type (about 600 at a time, the Gulf of Finland to the Bothnian Sea).

**The fences**: the telecom cables, power cables and gas pipelines in those waters (TeleGeography, OpenStreetMap,
EMODnet), each widened to a kilometre on either side, less 5 km around ports and cable landings, where ships are
expected to wait. 45 fences, kept in a Parquet file and tested with DuckDB's `spatial`.

**The rule**: a cargo ship or tanker inside a fence, under 3 knots or at anchor. One alert per ship and cable,
labelled `mmsi`, `ship`, `flag`, `type`, `cable`, `kind` and `signature`. Pending as the ship arrives, firing after
15 minutes; critical when a ship at anchor moves 2 to 6 knots, the sign of an anchor being dragged.

**The map**: **Entity label** `mmsi` puts each alert on its ship, **Zone label** `cable` colours each fence by its
own alerts, with the fences coming from the map's query of the Parquet file. The ships are a
[Fleet](/plus/layers/fleet) layer of 3D models by ship type, with cards; the alerts and fences layers are saved in
the map with their own look.

[![Following a tanker anchored over the Nord Stream 2 pipeline: its card open (0.9 knots, Lingering), its alert a ring around it, the pipeline's fence red, other ships at anchor nearby](/img/plus/geofence-follow.jpg)](https://pacha.ubica.dev/d/baltic-cable-watch)

_A click on a ship in the table makes the map follow it with its card open: here a tanker at anchor inside the fence
of a pipeline, firing._

Around the map:

- **Filters** (Chaski, in the browser): by the alert's state, type, flag, status or speed, and by cable. A ship
  filtered out takes its alert with it, and a cable its fence.
- **A table** of the ships lingering over a cable, with each alert's state and since when, read from Grafana's
  alerting API.
- **A time series** of the alerts firing and pending, minute by minute over the last day, rebuilt from the rule's
  state history (`/api/v1/rules/history?ruleUID=…`, which a viewer can read).

A slow ship over a cable is not an accusation: anchorages off busy ports lie over pipelines, and ships wait there for
a berth. The watch shows where to look.

## When the map shows no alerts

See [Active alerts: when no alerts are shown](/plus/data/active-alerts#when-no-alerts-are-shown). For geofences,
also check that:

1. the rule's alerts carry the **Entity label**, spelled as in the rule (labels are case-sensitive);
2. the panel's data has the **Entity column** with the same ids, as text or numbers, and a position (`latitude` and
   `longitude`, or names the map recognises);
3. the entity was in the data at the last refresh: an alert whose entity is not in it is `without a place`;
4. for zones from a query, the query has the **Zone column** and a geometry column, and the zone names match the
   alerts' zone label exactly.
