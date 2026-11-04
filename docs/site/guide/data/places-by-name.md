# Places by geohash or by name

A query does not need a latitude and a longitude to be drawn as points. It can give a **geohash**,
or a **place name or code** the panel looks up. Either way the rows become ordinary points: a Point
layer, a heatmap, an aggregation, anything a pair of coordinates allows.

Both are used only when the query has no coordinates of its own.

## Geohash

A column named `geohash` is decoded to the centre of its cell; any other column can be pointed at
with **Field mapping → Geohash**. Elasticsearch and OpenSearch geohash grid aggregations return
exactly this.

```sql
SELECT geohash, count(*) AS events FROM readings GROUP BY geohash;
```

A value that is not a geohash gives the row no position.

## Place names and codes

A column named `lookup`, or the one chosen in **Field mapping → Place name**, is looked up in a
**gazetteer**, chosen under **Map → Place names**:

| Gazetteer           | Looked up by                                                 |
| ------------------- | ------------------------------------------------------------ |
| Countries (default) | name, or the 2- or 3-letter ISO code: `Ecuador`, `EC`, `ECU` |
| US states           | name or postal code: `Texas`, `TX`                           |
| Airports            | IATA or ICAO code: `UIO`, `SEQM`                             |
| A URL of your own   | see below                                                    |

Matching is exact, or the same in upper case. The point is the place's centre — a country's
centroid, not its outline.

```sql
SELECT country_code AS lookup, sum(sales) AS sales FROM orders GROUP BY 1;
```

The three gazetteers are the ones Grafana ships, served by your own Grafana; nothing is fetched from
elsewhere. The file is only downloaded when a query names places, once per dashboard.

### Your own gazetteer

Type its address in **Place names**. Two shapes are read, the same two Geomap reads:

- a list of `{ "key" or "keys", "name", "latitude", "longitude" }`, matched by key, keys or name;
- a GeoJSON FeatureCollection, matched by the properties named `id`, `uid`, `key` or `code`, or
  ending in `_id` or `_code` (otherwise its first text property), and placed at the feature's point
  or at the middle of its extent.

A relative address is resolved against Grafana's root, as Geomap's are. A file that fails to load
leaves the rows unplaced, and says why in the browser console.

## Rows with an unknown place

They stay in the dataset — in the table, the filters and the tooltip — but have no position, so no
layer draws them.
