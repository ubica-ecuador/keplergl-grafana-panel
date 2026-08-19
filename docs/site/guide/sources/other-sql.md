# Any other SQL source

The panel reads Grafana **data frames**, not a particular protocol. Any data source that returns a
table works: MySQL, SQL Server, ClickHouse, BigQuery, Snowflake, Athena, Elasticsearch, Prometheus,
TestData DB. The three pages before this one exist because those sources have _specific_ traps, not
because they are the only ones supported.

## What is actually required

A query that returns columns the panel can recognise. That is the whole contract.

```sql
SELECT lat AS latitude, lon AS longitude, measured_at, value
FROM readings;
```

If the names are not recognised, alias them — or map them by hand under **Field mapping**, which is
per query. See [Field roles](../../reference/field-roles).

## Getting geometry out of a source without spatial functions

Plenty of warehouses have no PostGIS. Three options, in order of preference:

**Store WKT.** A plain text column of `POLYGON((...))` renders directly — kepler parses WKT itself.
Any warehouse can store and return text.

**Store GeoJSON.** Same, as a JSON string. Slightly larger on the wire than WKT.

**Store coordinates.** For points, two numeric columns beat any encoding: cheaper, indexable, and
impossible to get subtly wrong.

The one to avoid is a binary geometry type the warehouse cannot render as text, because there is no
step in between — the panel decodes WKB _hex_, not a binary blob that arrives as base64 or as an
opaque object.

## TestData DB, for building and demonstrating

Grafana's built-in TestData DB is worth knowing about here: its **CSV Content** scenario lets you
paste rows straight into the query, which means a working map with no data source to install at all.

It is how the plugin's own layer gallery dashboard drives thirteen maps, and how
[Tutorial 2](../../tutorials/trajectories) and [Tutorial 3](../../tutorials/od-flows) work in any
Grafana, including one where you cannot install anything.

## Time columns

The panel finds the time column **by type**, so what matters is that the data source declares it as
time rather than what it is called.

A source returning epoch integers or ISO strings that it types as number or string will not produce
a time filter. Cast in the query:

```sql
-- ClickHouse
SELECT toDateTime(ts_epoch) AS time, lat AS latitude, lon AS longitude FROM readings;

-- BigQuery
SELECT TIMESTAMP_SECONDS(ts_epoch) AS time, lat AS latitude, lon AS longitude FROM readings;
```

## Variable interpolation differs by source

This is the portability trap. The same query does not move between data sources unchanged:

| Behaviour                  | Sources                                        | Write    |
| -------------------------- | ---------------------------------------------- | -------- |
| Adds quotes around strings | DuckDB, and others using the SQL-string format | `$var`   |
| Does not                   | PostgreSQL                                     | `'$var'` |

Getting it wrong produces `''value''` and a parse error, or an unquoted string and a syntax error.
When in doubt, read the generated SQL in Grafana's **query inspector** before assuming the panel is
at fault.

Guard the empty value in either case — every published variable is empty before the first
interaction. See [Variable formats](../../reference/variable-formats).

## Volume belongs in the query

Every row travels from the data source through Grafana into the browser as JSON before anything is
drawn, and that transport — not deck.gl — is almost always the binding constraint.

```sql
-- aggregate to a cell rather than sending every point
SELECT h3_index AS h3, count(*) AS n, avg(speed) AS avg_speed
FROM readings GROUP BY 1;

-- or to a rounded coordinate, if you have no index column
SELECT round(lat, 3) AS latitude, round(lon, 3) AS longitude, count(*) AS n
FROM readings GROUP BY 1, 2;
```

Three decimal places is about 110 m. See [Under the hood](../../reference/under-the-hood) for what
each layer family tolerates.

## Several sources in one panel

Each query becomes its own kepler dataset, and the queries do not have to share a data source. A
panel can overlay boundaries from PostGIS, live points from an API through Infinity, and an
aggregate from a warehouse — three queries, three datasets, three layers you style independently.

That is often the cleanest answer to "this map needs data from two systems": let the panel do the
overlay rather than building a join somewhere.
