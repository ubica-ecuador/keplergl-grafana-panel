# Exporting data

kepler's **Export Data** writes the map's datasets to a file, in the browser, from whatever the
panel holds at that moment. It is in the export menu behind the download icon at the top of kepler's
side panel.

## Formats

| Data type | What you get                        |
| --------- | ----------------------------------- |
| `csv`     | a CSV                               |
| `geojson` | a GeoJSON feature collection        |
| `parquet` | a GeoParquet file                   |
| `shp`     | a Shapefile, zipped                 |
| `gpkg`    | a GeoPackage (SQLite), in EPSG:4326 |
| `kml`     | a KML                               |
| `kmz`     | a zipped KML                        |

The dialog also asks for the **Dataset** — all of them, or one — and whether to write the
**Filtered** rows, the ones kepler's filters leave on the map, or the **Unfiltered** ones, every row
the query returned. The file is named after the dataset: `kepler.gl_Query-A.gpkg` for one called
_Query A_.

## Nothing leaves the browser

The file is written where the map is drawn. GeoPackage and GeoParquet need a writer compiled to
WebAssembly, sql.js and parquet-wasm, which kepler on its own fetches from cdn.jsdelivr.net and
unpkg.com at the moment of exporting; the plugin ships both and serves them from Grafana, under
`public/plugins/ubica-keplergl-panel/loaders/`, so an export asks no other host for anything and a
hardened Grafana needs nothing added to its Content-Security-Policy for it. See
[Differences from stock kepler.gl](../../reference/differences-from-kepler#exports-write-with-the-plugin-s-own-code).

## Who can export

Anyone who can open kepler's side panel, viewers included: the export is kepler's, and it knows
nothing of Grafana's roles. What it writes is only what the query already sent to that browser,
which Grafana's own **Inspect → Data** offers too. So the way to keep data from a dashboard's
readers is the query: leave out the rows and columns the map does not need.

---

**Upstream:** [Save and export](https://docs.kepler.gl/docs/user-guides/k-save-and-export)

Written against **kepler.gl 3.3.0-alpha.17**. See
[Upstream documentation](../../reference/upstream-docs).
