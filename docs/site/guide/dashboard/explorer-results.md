# Explorer results on the map

In the self-hosted Grafana Geospatial Stack, the Chaski datasource keeps a dashboard's data in
DuckDB in the browser, and the SQLRooms explorer lets you query it freely. The explorer can send
a query's result to the map. It lands as a dataset of its own, next to the panel's queries.

This needs Chaski on the same Grafana. Where Chaski is not installed, the map ignores these requests.

## What you get

- **A dataset named after the label** you gave the result, with default layers built from its
  columns: a geometry column, or latitude and longitude columns.
- **Add or replace.** "Add" keeps earlier results, and a second one with the same label shows up as
  "Label (2)". "Replace" swaps the rows of the dataset with exactly that label and keeps its layers;
  "Hot spots" and "hot spots" are two datasets. With no such dataset, it adds one.
- **At most 200 000 rows.** A larger result shows its first 200 000, with a warning.
- **One result at a time per map.** Each result waits for the previous one on that map, query
  included, so results sent in quick succession land in the order they were sent. One the map
  cannot take shows an error after 10 seconds.

## It lasts for the session

Explorer datasets are not saved with the dashboard:

- a data refresh keeps them;
- changing the map configuration, reloading the page or opening the dashboard again loses them.

If you save the map configuration with a layer drawn from an explorer dataset, that layer is
dropped the next time the dashboard opens, because its data is gone. To keep a result, turn its
query into a panel query.

## For plugin authors

The request is the `ubica-explorer-to-map` event on Grafana's app event bus:

```ts
{ sql: string; label: string; geometryColumn?: string; mode: 'add' | 'replace'; panelId?: number }
```

- **`sql`** runs on Chaski's engine on its panel path, so qualify names: `datasets.<name>` and
  `explore.<table>`; a bare `sample` won't resolve.
- **`geometryColumn`** must be a DuckDB `GEOMETRY` column.
- **Without `panelId`,** every kepler map on the dashboard takes the request.
