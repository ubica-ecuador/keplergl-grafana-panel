# Infinity — GeoJSON, CSV and WFS

::: warning Not written yet
This page is part of the documentation skeleton. Its content lands in phase 4.
:::

What it will cover:

- GeoJSON from a URL: the parser, rows/root selector and column setup that flattens it into rows
- CSV: setting lat/lng columns to Number, because the parser defaults everything to string
- WFS: requesting `outputFormat=application/json` and, critically, `srsName=EPSG:4326`
- What goes wrong when a GeoServer returns the layer's native CRS
