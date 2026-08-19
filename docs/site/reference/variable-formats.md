# Variable formats

Exactly what the panel writes into a dashboard variable, per channel, and how to consume it safely.

## Summary

| Channel         | Variables | Value                                                |
| --------------- | --------- | ---------------------------------------------------- |
| Filter (scalar) | 1         | the filter's value, as a string                      |
| Filter (range)  | 2         | numeric min and max, as strings                      |
| Time window     | 2         | UTC ISO 8601                                         |
| Click           | 1         | the clicked entity's column value                    |
| Coordinates     | 2         | latitude and longitude, 6 decimal places             |
| Viewport        | 4         | west, south, east, north — degrees, 6 decimal places |
| Drawn area      | 1         | WKT in EPSG:4326                                     |

Everything is written as a **string**, because that is what a dashboard variable holds.

## Time window

```
2026-08-18T14:30:00.000Z
```

UTC ISO 8601, as produced by `toISOString`. Chosen over epoch milliseconds because the target is
usually a SQL `timestamptz`, and because it is legible in a URL and in a shared link.

Reading is more permissive than writing: ISO, any `Date`-parseable string, epoch ms as a number, or
epoch ms as a numeric string. The empty string and Grafana's `$__all` are read as "no window".

## Coordinates

Two variables — latitude in the first, longitude in the second — each a decimal degree rounded to
**six decimal places**, about 0.1 m.

The rounding is not cosmetic: it means re-pinning the same spot does not rewrite the variable, and
so does not re-run every panel that reads it.

Values survive an unpin. Clicking again unpins the marker on the map, but the variables keep the
last position until the next pin, so a consuming spatial query never runs with an empty centre.

## Viewport

Four variables, each a decimal degree rounded to six places:

| Variable | Edge              |
| -------- | ----------------- |
| west     | minimum longitude |
| south    | minimum latitude  |
| east     | maximum longitude |
| north    | maximum latitude  |

Numbers rather than a geometry, deliberately: there is nothing free-form for a consuming query to
interpolate.

Coordinates are **clamped to valid ranges**. Zoomed far enough out the computed span runs past the
antimeridian and the poles, and no consumer should be handed a longitude of −250.

Published **once on load**, then 300 ms after the map comes to rest. A value that has not changed
numerically is not rewritten.

## Drawn area

**WKT in EPSG:4326**, for example:

```
POLYGON((-79.01 -2.91,-78.98 -2.91,-78.98 -2.88,-79.01 -2.88,-79.01 -2.91))
```

Only the **most recent** figure. Deleting the last one clears the variable to the **empty string** —
which is what the `!= ''` guard in every example is for.

Never written on dashboard load, so a shared link keeps the area it was opened with.

## Range filters

Two variables holding the numeric bounds as strings. When the filter is removed **both are written
blank**, rather than left holding their old values — otherwise the map would be at "no filter" while
the variables held a range, and neither side would ever match the last agreement again.

## Consuming safely

### Guard the empty value

Every channel can be empty: before the first interaction, after a clear, or on a fresh dashboard.
Panels reading the variable run anyway.

```sql
-- drawn area
WHERE $area != '' AND ST_Intersects(geom, ST_GeomFromText($area, 4326))

-- coordinates
WHERE $lat != '' AND ST_DWithin(geom, ST_MakePoint($lng, $lat)::geography, $radius)

-- time window, PostgreSQL
WHERE ('$from' = '' OR ts >= '$from'::timestamptz)
```

### Quoting depends on the data source

::: warning Do not quote a variable on a source that interpolates with a SQL string format
Some data sources — the DuckDB one among them — add the quotes themselves. `'$var'` arrives as
`''value''` and fails to parse. Write `$var`, and cast defensively:

```sql
WHERE ts >= coalesce(try_cast($from AS TIMESTAMPTZ), '-infinity')
```

The PostgreSQL data source does not do this; there, quote normally. When in doubt, read the
generated SQL in the query inspector.
:::

### Do not consume your own map's output

Putting the viewport or the drawn area into **this** panel's query makes the map filter itself, and
the filter cannot be widened again — the rows are gone. See
[Publishing](../guide/dashboard/publishing).

### Multi-value variables

Grafana repeats a variable in the URL when it is multi-value. Every single-valued channel here reads
the **first** entry, so a variable that has accidentally become multi-value degrades rather than
breaking.
