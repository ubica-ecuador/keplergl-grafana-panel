# H3 and S2

Two ways to say "this cell of a global grid", and two layers that draw them. Neither needs
coordinates: the identifier _is_ the geometry, and the layer derives the boundary from it.

## H3

Uber's hexagonal grid. A column of H3 indices becomes a hexagon layer.

```sql
SELECT h3_index AS h3,
       COUNT(*) AS rides,
       AVG(fare) AS avg_fare
FROM journeys
GROUP BY 1;
```

### How it is detected

Two mechanisms, and it is worth knowing they are different.

The **panel** recognises a column named `h3`, `h3_index`, `hex_id`, `hexagon` or `h3index` and
assigns it the H3 role, which renames it to `h3` on the way in. That is what makes the mapping
explicit and portable into a saved configuration.

**kepler** then detects the layer by **field type, not by name**: its analyser types a string
column as H3 when the values are valid H3 cells, and the hexagon layer picks up any column of that
type. So a column of valid indices produces a hexagon layer even under a name neither list covers.

The practical consequence: H3 usually just works, and when it does not the cause is almost always
the _values_ rather than the name — a truncated index, an integer where a hex string was expected,
or a mix of resolutions.

### Resolution

An H3 index carries its own resolution, so the layer reads it per row; nothing needs configuring.

Mixing resolutions in one column is legal and draws correctly — you get hexagons of different sizes
side by side — but it makes the colour scale meaningless, because a resolution-8 cell covers about
seven times the area of a resolution-9 one and the counts are not comparable. Aggregate to a single
resolution in SQL.

Which resolution to pick is a question about your view, not your data. Roughly:

| Resolution | Edge length | Sensible at         |
| ---------- | ----------- | ------------------- |
| 6          | ~3.2 km     | a region            |
| 7          | ~1.2 km     | a metropolitan area |
| 8          | ~460 m      | a city              |
| 9          | ~175 m      | a district          |
| 10         | ~65 m       | a few streets       |

### H3 for flows

The same grid drives origin–destination flows: map `origin_h3` and `dest_h3` instead of two
coordinate pairs, and you get hexagon-to-hexagon flows. See
[Origin–destination flows](./flows).

## S2

Google's quadrilateral grid, addressed by token. A column of S2 tokens becomes an S2 layer.

```sql
SELECT s2_token AS s2,
       COUNT(*) AS observations
FROM sightings
GROUP BY 1;
```

::: warning S2 is not one of the panel's roles
There is no S2 entry in Field mapping. The layer comes from **kepler's own detection**, which looks
for a column named exactly **`s2`** or **`s2_token`** — by name, unlike H3.

So alias it in the query. A column called `cell`, `token` or `quadkey` will not produce an S2 layer
on its own; you would have to build the layer by hand in kepler's layer panel and then save the map
configuration to keep it.
:::

S2 tokens encode their level the way H3 indices encode resolution, so again nothing needs setting —
and again, mixing levels makes a colour scale dishonest.

## Which to use

If you have a choice, H3 is the better-supported path here: it is a panel role, it is detected from
values rather than names, and it works for flows. S2 is worth using when your data already arrives
as S2 — from BigQuery, from a Google-adjacent pipeline, or from a system that indexes with it — in
which case the only requirement is naming the column `s2`.

## Why aggregate in SQL

Both layers exist to make a large point set legible, and both work best when the aggregation has
already happened. A million rows of raw points aggregated in the browser is a million rows
transported; the same data grouped by cell in the query is a few thousand.

```sql
-- do this
SELECT h3_index AS h3, COUNT(*) AS n, AVG(speed) AS avg_speed
FROM readings GROUP BY 1;

-- not this
SELECT h3_index AS h3, speed FROM readings;   -- a million rows to the browser
```

kepler's grid, hexbin and cluster layers will aggregate raw points for you and are the right tool
when you do not have a cell column at all — see
[the layer gallery](../../layers/points-and-aggregation). But when your data is already indexed,
grouping in the database is strictly cheaper.
