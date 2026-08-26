# Measuring imagery

Drawing a raster and measuring one are two different jobs, and this page is the second. Nothing here
turns pixels into shapes so they can be drawn — the imagery is still drawn as imagery, and what
travels is an **aggregate**: a mean over a polygon, the value under a click, one row per zone.

Which is convenient, because a table is exactly what a Grafana panel eats. The map keeps drawing the
scene; the stat panel beside it reports a number about the same scene.

Three ways to get one, in increasing order of what they can do.

## Ask the tile server

The [tile server](../data/rasters#something-has-to-read-the-file) you already run to draw a COG will
also compute statistics over it. These are ordinary read-only HTTP calls, so the
[Infinity](./infinity) data source can make them with no database involved.

| Route                                       | Answers                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /cog/statistics?url=…`                 | min, max, mean, count, sum, std, median, percentiles, histogram, valid share |
| `GET /cog/point/{lon},{lat}?url=…`          | the value under one coordinate                                              |
| `POST /cog/statistics?url=…` + GeoJSON body | the same statistics over **one polygon**, keeping the feature's properties  |

The point route pairs with the map: the panel publishes the coordinate you clicked to dashboard
variables, so a stat panel reading `$lat`/`$lng` reports the pixel under your click and changes when
you click elsewhere. The polygon route pairs with drawn areas the same way — the map publishes the
polygon you draw as WKT. See [Publishing viewport and areas](../dashboard/publishing).

Three details that otherwise cost an iteration:

- Use **`Parser: Backend`**. The request is then made by the Grafana server, which reaches a tile
  server on its own network by name and involves neither CORS nor the browser.
- For a scalar answer, point the **root selector at the array** — `values`, not `values[0]`. A
  column selector into a scalar returns null under the backend parser.
- A stat panel wants **one numeric field** in the frame. With two numbers and no text column,
  Infinity types the frame as numeric-long and the panel reports "No data".

::: warning One request per zone
This is ideal for a handful of zones and wrong for four thousand. That case is the next section.

Also: a tile server reading rasters is doing CPU work, and the stock TiTiler image runs a **single
worker**. A zonal statistic then queues behind the dozen tiles the map asked for on the same load —
measured at 5.9 s alone, 11.6 s competing, and 4.7 s with four workers, against Grafana's 60 s
timeout.
:::

## Compute it in DuckDB

What a tile server cannot do is **cross the imagery with your own tables**. DuckDB's `raster`
community extension can, and it does not need anything added to the data source's startup SQL — the
query loads it itself:

```sql
INSTALL raster FROM community; LOAD raster;
SELECT RT_GdalConfig('CURL_CA_BUNDLE', '/etc/ssl/certs/ca-certificates.crt');

SELECT z.name,
       RT_CubeStats_Agg(
         RT_CubeSetNoData(
           RT_CubeClip(r.databand_1, r.tile_x, r.tile_y, r.metadata, z.geom, 0.0), 0.0), 0) AS stats
FROM RT_Read('scene.tif') r
JOIN zones z ON ST_Intersects(r.geometry, z.geom)
GROUP BY z.name;
```

`RT_Read` returns the raster **in tiles**, one row each, and filtering on `geometry` or `bbox`
discards tiles before their pixels are read — which is what keeps this from pulling a whole scene
into memory. Four thousand polygons joined to a scene is one query rather than four thousand HTTP
requests, and the result carries whatever else lived in your `zones` table.

Three things that fail quietly:

- **`RT_CubeClip(cube, tile_x, tile_y, metadata, geom, value)`** — the two integers are the tile's
  **position** in the grid, which is what places its pixels in the world. Passing the tile's width
  and height instead raises no error and returns **all zeros**.
- **The clip's fill counts as data** unless you say otherwise. Wrapping it in `RT_CubeSetNoData`
  with the same fill value is what stops the mean being dragged towards it.
- **The GDAL inside the extension looks for the CA bundle at a RedHat path** on a Ubuntu image, so
  any `/vsicurl/` read dies with a curl error until the config line above sets it.

## Read a WMS as data: WCS {#wcs}

A [WMS](../data/wms) hands out pictures, which is a wall for anything you want to compute. But a
GeoServer that publishes a WMS usually publishes a **WCS** over the same coverage — the same scene,
delivered as pixels rather than as a rendering. The imagery on the map becomes something a query can
work on, with no second source and no ETL:

```sql
INSTALL raster FROM community; LOAD raster;
SELECT RT_GdalConfig('CURL_CA_BUNDLE', '/etc/ssl/certs/ca-certificates.crt');
SET VARIABLE coverage = '/vsicurl/<service>/wcs?service=WCS&version=2.0.1&request=GetCoverage&…';
SELECT RT_CubeStats_Agg(
         RT_CubeClip(databand_1, tile_x, tile_y, metadata, ST_GeomFromText($area), -99.0), 0)
FROM RT_Read(getvariable('coverage'));
```

`$area` is the polygon the map publishes when you draw one, so the number follows the shape on
screen. Five things are worth knowing before you write your own:

- **`RT_Read` needs a literal path**, so the URL is assembled into a variable and read back with
  `getvariable()`. The data source runs multi-statement scripts and returns the last one's result,
  which is what keeps this a single panel query.
- **Ask the service which date it has.** Deriving one from the dashboard range gives a 404 the day
  the range runs ahead of the last pass — the same `GetCapabilities` the map reads answers this.
- **The band index is zero-based.** `RT_CubeStats(cube, 1)` on a one-band coverage fails with
  `Band index out of range`.
- **Do not set the nodata value.** The GeoTIFF declares its own and the aggregate honours it;
  overwriting it with `RT_CubeSetNoData` returned negative minima for a rainfall product. The clip's
  fill is enough, and a fill equal to the service's own sentinel is discarded automatically.
- **The request happens on the Grafana server**, not in the browser, so CORS and CSP have nothing to
  do with it — but the server is what must be able to reach the service.

## Writing a raster, and drawing that

The loop closes the other way too. `COPY … FORMAT RASTER` writes a COG, so an index computed in SQL
can be drawn through exactly the path a Sentinel scene takes — the panel cannot tell the difference:

```sql
COPY (
  SELECT r.geometry,
         RT_Cube2TypeUInt16(((n.databand_1 - r.databand_1) / (n.databand_1 + r.databand_1)
                             + 0.2) / 1.1 * 65535.0) AS ndvi
  FROM RT_Read('red.tif') r JOIN RT_Read('nir.tif') n ON r.id = n.id)
TO 'ndvi.tif'
WITH (FORMAT RASTER, DRIVER 'COG', SRS 'EPSG:4326',
      DATABAND_COLUMNS ['ndvi'],
      CREATION_OPTIONS ('COMPRESS=DEFLATE', 'OVERVIEW_RESAMPLING=AVERAGE'));
```

Point a `raster_url` column at the result and it draws. See
[Satellite imagery and other rasters](../data/rasters).

Five things about that are worth knowing before you spend an afternoon on them:

- **Write an integer type.** kepler cannot draw a `float32` raster: it has no maximum value to
  rescale a float against, and gives up — leaving a layer that renders nothing and reports nothing.
  `uint8` draws, but flat. **`uint16` is what works**, so scale your index onto it, as above.
- **`DATABAND_COLUMNS` is required**, even though the extension's own example omits it.
- **Overwriting fails.** `COPY` writes the file and then cannot find a temporary it has already
  moved: the file is fine and the query errors. Which pushes towards the pattern you want anyway —
  a deterministic name per scene and formula, written once, never recomputed on a refresh.
- **Default overviews are nearest-neighbour**, and a sparse field — rainfall over a tenth of the
  area — then draws **empty** at continental zoom while the file is perfectly full.
  `OVERVIEW_RESAMPLING=AVERAGE` is the fix.
- **The tile server has to be able to read the file.** It reads on the map's behalf, so a raster
  written to a path only the database can see is invisible to everyone. Share the directory, or
  write to object storage both can reach.

::: warning Materialising is not a query
It writes a file, and a dashboard refreshing every 30 seconds must not redo it. Keep it out of the
dashboard: compute it once, and let the panels read what is there.
:::

## When to reach for which

| You want                                   | Use                       |
| ------------------------------------------ | ------------------------- |
| a number about one scene, or one polygon   | the tile server, via Infinity |
| the value under a click                    | the tile server, via Infinity |
| one row per zone, over thousands of zones  | DuckDB `raster`           |
| the imagery joined to your own tables      | DuckDB `raster`           |
| numbers out of a WMS you can only see      | WCS + DuckDB `raster`     |
| a new raster to draw                       | `COPY … FORMAT RASTER`    |
