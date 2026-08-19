# DuckDB and GeoParquet

::: warning Not written yet
This page is part of the documentation skeleton. Its content lands in phase 4.
:::

What it will cover:

- Loading the spatial extension once via Init SQL rather than per query
- Why `ST_GeomFromWKB` is a binder error, not a no-op, when spatial is loaded
- Casting `ST_AsGeoJSON(...)` to VARCHAR
- Local files, S3, and remote HTTPS
- `force_download` for endpoints that build the file per request, and why you want the opposite against a stable object store
- glibc versus Alpine, and that the data source is unsigned and outside the catalog
