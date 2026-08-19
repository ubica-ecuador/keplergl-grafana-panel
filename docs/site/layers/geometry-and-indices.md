# Geometry and spatial indices

Three layers whose shape comes from the data rather than from a coordinate pair: an explicit
geometry, and two global grids addressed by identifier.

## geojson

![The GeoJSON layer](/img/layer-geojson.jpg)

```sql
SELECT geom, name, value, zona
FROM neighbourhoods;
```

Polygons, lines and points from a geometry column. **Built automatically** — the panel renames the
column to kepler's `_geojson` and kepler creates the layer.

The column can hold **GeoJSON, WKT, or raw WKB/EWKB hex**; the image above is WKT. WKB decoding
happens in the plugin, which is what lets a plain `SELECT geom` from PostGIS render with no
`ST_AsGeoJSON` around it. See [Geometry](../guide/data/geometry).

Fill and stroke are separately controllable, and polygons can be extruded into 3D by a column with
the 3D control on.

**Cost:** the only layer here whose weight is unrelated to its row count. A hundred detailed
municipal boundaries can outweigh a million points. Simplify in the query —
`ST_Simplify(geom, 0.0005)` — rather than hoping the browser copes.

Backed by deck.gl's `GeoJsonLayer`.

## h3

![The H3 hexagon layer](/img/layer-h3.jpg)

```sql
SELECT h3_index AS h3, COUNT(*) AS value, zona
FROM readings
GROUP BY 1, 3;
```

Uber's hexagonal grid. The index _is_ the geometry: the layer derives each hexagon's boundary from
the identifier, and the resolution comes from the index itself, so nothing needs configuring.

**Built automatically**, and by a mechanism worth knowing: kepler types a string column as H3 when
its **values** are valid H3 cells, so detection is by content rather than by name. A column of good
indices produces a layer under any name.

Distinct from the [hexagon layer](./points-and-aggregation#hexagon), which bins raw points in the
browser. This one draws cells your data already carries — which means the aggregation happened in
SQL, where it is far cheaper.

Backed by deck.gl's `H3HexagonLayer`, plus `ColumnLayer` when extruded.

## s2

![The S2 layer](/img/layer-s2.jpg)

```sql
SELECT s2_token AS s2, COUNT(*) AS value, zona
FROM sightings
GROUP BY 1, 3;
```

Google's quadrilateral grid, addressed by token. The same idea as H3 with square cells.

::: warning S2 is detected by name, not by value
There is **no S2 role** in Field mapping, and kepler's own detection looks for a column named
exactly `s2` or `s2_token`. A column called anything else produces no layer.

The gallery panel above is an illustration of this: its column is called `token`, so the layer is
not autodetected at all — it is pinned by a saved map configuration. In your own dashboard, alias
the column to `s2` and it works without one.
:::

Backed by deck.gl's `S2Layer`.

## Choosing between them

| Your data is                                      | Use                                         |
| ------------------------------------------------- | ------------------------------------------- |
| Real boundaries — administrative, parcels, routes | geojson                                     |
| Already aggregated to H3 cells                    | h3                                          |
| Already aggregated to S2 cells                    | s2                                          |
| Raw points you want binned                        | [hexagon or grid](./points-and-aggregation) |

Between H3 and S2, prefer **H3** if you have a choice: it is a panel role, it is detected from
values rather than names, and it works for origin–destination flows. Use S2 when your data already
arrives that way.
