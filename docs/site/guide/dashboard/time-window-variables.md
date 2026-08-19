# Time window variables

With **Time range sync** set to _Slider writes variables_, the map's time brush is published to two
dashboard variables. Other panels read them; the dashboard time range never moves.

## Setting it up

1. Add two dashboard variables. **Text box** works, and so does a constant — anything that can hold
   a string and be written from the URL.
2. Set **Time range sync** to _Slider writes variables_.
3. Under **Time window variables**, name the variable that holds the start and the one that holds
   the end.
4. Read them in another panel's query.

## The value format

**UTC ISO 8601**, as produced by `Date.prototype.toISOString`:

```
2026-08-18T14:30:00.000Z
```

ISO rather than epoch milliseconds because the target is almost always a SQL `timestamptz`. The
value drops straight into a comparison with no arithmetic, it is legible in the URL, and it is
legible in a shared dashboard link — which matters, because a link carries the window someone was
looking at.

Reading a variable back is more permissive than writing one: an ISO string, any `Date`-parseable
string, epoch milliseconds as a number, or epoch milliseconds as a numeric string are all accepted.
An empty value, or Grafana's `$__all`, is read as "no window" rather than as an error.

## Consuming it

```sql
SELECT count(*) AS events
FROM quakes
WHERE ts >= '$mapFrom'::timestamptz
  AND ts <  '$mapTo'::timestamptz;
```

::: warning Quoting depends on the data source
Some data sources interpolate variables using Grafana's SQL-string format, which **adds the quotes
itself**. On those, `'$mapFrom'` arrives as `''2026-08-18T14:30:00.000Z''` and fails to parse.
Write `$mapFrom` unquoted there.

The DuckDB data source is one of these. The PostgreSQL one is not. When in doubt, look at the
generated SQL in the query inspector before assuming detection is broken.
:::

### Guard the empty value

Before the first brush the variables are empty, and every panel reading them runs anyway. Give the
query somewhere to fall back to:

```sql
-- DuckDB: unquoted, with a cast that tolerates the empty string
WHERE ts >= coalesce(try_cast($mapFrom AS TIMESTAMPTZ), '-infinity')
  AND ts <  coalesce(try_cast($mapTo   AS TIMESTAMPTZ), 'infinity')
```

```sql
-- PostgreSQL: quoted, with an explicit empty check
WHERE ('$mapFrom' = '' OR ts >= '$mapFrom'::timestamptz)
  AND ('$mapTo'   = '' OR ts <  '$mapTo'::timestamptz)
```

## Update variables while playing

Off by default. When on, the window is written **as the animation runs** rather than only when it
stops.

It is not free. Every write propagates a variable change through the whole dashboard, which re-runs
the panels that read it and costs the animation its frames. Turn it on when watching the numbers
move alongside the map matters more than smooth playback — a live counter beside an animated map is
the case it is for.

Left off, you get smooth playback and the numbers update once, when you stop.

## Why not just move the dashboard range

Because moving the range re-runs the map's own query, and the rows that fall outside the new window
leave the browser. The histogram under the time slider rescales beneath your cursor, and the window
can never be widened again from the map — the data to widen into is gone.

Variables cost only the panels that actually reference them. The map keeps its whole dataset, and
the brush stays a mask rather than a filter on the query. The full comparison is on
[Time range sync](./time-range-sync).
