# Routes and networks

Two ways of drawing lines from rows that are points: a **route** joins one query's rows in the order
they come, and a **network** joins the nodes of one query by the edges of another.

## Routes

**Map → Draw as a route** and pick the queries. Each row is joined to the next, in the order the
query returns them, so order the query by time:

```sql
SELECT time, lat, lon, speed FROM gps WHERE vehicle = 'T1' ORDER BY time;
```

The query keeps its own dataset and layers. Beside it the panel adds a dataset of segments,
**"Query A · route"**, one row per pair of consecutive rows: the starting row's columns, plus both
ends as `lat0`, `lng0`, `lat1`, `lng1`. A **Line** layer draws them.

| Query A (points)          | Query A · route (segments)   |
| ------------------------- | ---------------------------- |
| row 1 `-2.890, -79.00` 20 | 1 → 2, with row 1's speed 20 |
| row 2 `-2.889, -78.99` 35 | 2 → 3, with row 2's speed 35 |
| row 3 `-2.887, -78.98` 70 | 3 → 4, with row 3's speed 70 |
| row 4 `-2.884, -78.98` 55 |                              |

Because each segment carries its starting row, the line can be coloured and sized by any column,
and the Line layer's **target arrow** shows the direction of travel.

A row with no position breaks the route at that point: the segments into and out of it are left
out.

::: tip On a map with a saved configuration
The Line layer is added by itself only while the map has no saved configuration, like every layer
the panel builds for you. Once it has one, add a Line layer on the route dataset in the side panel,
its columns `lat0`/`lng0` → `lat1`/`lng1`, and save the map.
:::

### When not to use it

A route is one line through every row. Rows of several vehicles in one query make one line jumping
between them: for those, a trip id makes [trajectories](./trajectories), one animated path per
vehicle.

## Networks

A query of **edges** is drawn as lines between the **nodes** of another query. This is the shape of
Grafana's Node graph panel, and nothing has to be configured:

- the edges are the frame named `edges`, or the one with `source` and `target` columns, and no
  coordinates of its own;
- the nodes are another query with an `id` column and coordinates.

```sql
-- A: nodes
SELECT code AS id, name, lat, lon FROM stations;
-- B: edges
SELECT source, target, trips FROM links;
```

Each edge takes the positions of its two nodes and keeps its own columns, so a Line layer can colour
and size it by `trips`. An edge whose source or target is not among the nodes is left out. The nodes
are an ordinary point dataset.
