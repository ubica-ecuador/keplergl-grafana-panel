# Migrating from the Foursquare Studio panel

Foursquare publishes its own Grafana panel, which renders its map in an **iframe against
`studio.foursquare.com`** and therefore requires a Foursquare account. This plugin runs kepler.gl
inside the panel instead: no external service, no account, no token.

If you are coming from there, this page maps one onto the other.

::: info Sourced, and dated
Everything stated here about the Foursquare Studio panel comes from
[its public documentation](https://docs.foursquare.com/analytics-products/docs/integrations-grafana),
as of the **12 February 2026** revision. Their product changes independently of this page — check
the source before relying on a comparison.
:::

## Column conventions

Their plugin keys on specific column names. Ours detects a wider set and lets you override any of it
per query.

| What you want        | Foursquare Studio panel                         | This panel                                                                               |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Points               | `latitude`, `longitude`                         | those, plus `lat`, `lon`, `lng`, `long`, `x`, `y` — or map any column by hand            |
| Time                 | a `time` column, **Unix timestamp, ascending**  | any column the data source typed as time, under any name                                 |
| Connected lines      | add `time`; points connect in order             | a **trip id** groups the points; `ORDER BY` is not load-bearing, they are sorted for you |
| Animation            | enable an animation toggle after enabling lines | automatic — a trip id + time + position **is** an animated Trip layer                    |
| Whole-object GeoJSON | a `geojson_layer` column                        | a geometry column                                                                        |
| Row-level GeoJSON    | a `geojson` column                              | the same, plus `geom`, `geometry`, `the_geom`, `wkb_geometry`, `wkt`, `shape`            |
| Raw PostGIS geometry | not supported — convert first                   | **works as-is**; WKB/EWKB hex is decoded for you                                         |

The practical difference is the direction of the coupling. Their conventions ask you to **rewrite
your queries around the plugin**; here, an unrecognised column is a dropdown in **Field mapping**
rather than a query rewrite. See [Field roles](../reference/field-roles).

### The one to watch: trips

Theirs connects points in the order the rows arrive, using `time` as the sequence. Ours groups by a
**trip id** first, then orders within each trip.

That means a query which produced one long polyline there will produce _n_ separate animated
trajectories here — which is almost always what you actually wanted, but it is a visible change. If
your table genuinely has no trip id, add a constant one:

```sql
SELECT 1 AS trip_id, lat AS latitude, lon AS longitude, ts AS time
FROM readings ORDER BY ts;
```

## Bringing a saved map across

**Map configuration → Import configuration**, and paste the JSON.

Both shapes are accepted: the bare `{ version, config }` saved config, and a full exported
`{ datasets, config, info }` map. From the second only the `config` half is kept — the data comes
from your own queries.

Configurations from **older kepler releases are migrated** by kepler's own schema on the way in.
That matters because Foursquare Studio exports from whatever version it happens to run, and Dekart
is still on kepler 3.2.6. It is pinned by a characterisation test in this plugin's suite, so a
regression in kepler's migration path fails a build rather than someone's dashboard.

**What will need fixing afterwards:** a pasted configuration references datasets by id, and this
panel's ids come from your query `refId`s. Import it, re-point each layer at your dataset in
kepler's layer panel, then **Save current map**. After that it is stable.

## What each side has that the other does not

### Theirs, not ours

- **Export to Foursquare Cloud** — push a map to a Studio account with a name and description. There
  is no equivalent here, by design: the plugin exists to avoid the dependency on that account.
- **A Grafana floor of 7.0.** Ours needs 12.0.10 or later, for
  [a specific reason](./install#requirements). If you are on an older Grafana, this plugin is not an
  option yet.

### Ours, not theirs

- **No account, and no iframe.** The map runs in the panel, against your rows.
- **Automatic origin–destination flow layers** — see [Flows](./data/flows).
- **Animated velocity fields** from a grid of wind or current vectors — see
  [Velocity fields](./data/velocity-fields).
- **Cross-filtering into dashboard variables**: filters, clicked entities, clicked coordinates, and
  reading a coordinate pair back to move the map — see
  [Cross-filtering](./dashboard/cross-filtering).
- **Publishing the viewport and drawn areas** to variables, for spatial queries on other panels —
  see [Publishing](./dashboard/publishing).
- **Peer time sync** between maps, in the browser, with no queries — see
  [Peer time sync](./dashboard/peer-time-sync).
- **Theme following**, base map included.
- **Esri satellite and topographic base maps, and two with real elevation**, none needing a token.
- **Raw WKB/EWKB geometry**, H3 and S2.
- **Styling survives a refresh.** Their panel removes and re-adds the dataset on every refresh, which
  discards the layer configuration each time the query re-runs. Ours swaps the data underneath the
  layers.

### Neither

Grafana Cloud. Their documentation notes the plugin is unavailable to new Grafana Cloud users;
ours cannot be installed there either while it is unsigned. Both are self-hosted propositions today.

## A fair summary

If you already have a Foursquare Studio account and your workflow is _build in Studio, publish to
Grafana_, their panel fits that workflow and this one does not replace it.

If what you want is kepler.gl on your own dashboard, against your own database, with no third-party
account and no data leaving your Grafana — that is what this plugin is for, and the spatio-temporal
features above are what it adds on top.
