# STAC catalogues

A [STAC](https://stacspec.org/) catalogue is a searchable index of satellite imagery: every scene is
an item carrying a **footprint**, a timestamp, a cloud figure and links to the files. Public
catalogues cover the planet and cost nothing to query.

The interesting question is rarely "show me a scene". It is: *which scenes cover the areas I care
about, how much of each area do they cover, and which areas got nothing?* That is a spatial join
between a catalogue and a table of your own polygons, and DuckDB does it in SQL, in a panel, with no
cluster and no ETL.

## A catalogue is a table

A STAC search is an HTTP GET that returns GeoJSON. The `http_client` extension makes the call, the
JSON functions take it apart, and `ST_GeomFromGeoJSON` turns each footprint into real geometry:

```sql
WITH resp AS (
  SELECT http_get('https://earth-search.aws.element84.com/v1/search'
    || '?collections=sentinel-2-l2a'
    || '&bbox=-79.6,-3.3,-78.6,-2.4'
    || '&datetime=' || $__timeFrom() || '/' || $__timeTo()
    || '&limit=200') AS r
),
features AS (
  SELECT unnest(json_extract(r->>'body', '$.features[*]')) AS f FROM resp
)
SELECT f->>'id'                                     AS scene_id,
       (f->'properties'->>'datetime')::TIMESTAMP    AS acquired,
       (f->'properties'->>'eo:cloud_cover')::DOUBLE AS cloud_cover,
       f->'assets'->'visual'->>'href'               AS raster_url,
       ST_GeomFromGeoJSON(f->>'geometry')           AS footprint
FROM features
```

From here it is an ordinary table. `raster_url` alone already
[draws the scene](../data/rasters); `footprint` is what makes it joinable.

::: tip The catalogue answers questions pixels cannot
`eo:cloud_cover`, `proj:epsg`, the acquisition time and the footprint all arrive as columns before a
single byte of imagery is read. Filtering on them costs nothing.
:::

## Push the search down, then refine it

Everything you put in the search URL — bounding box, time range, collection — is evaluated by the
**API**, not by you. That is the whole performance story, and it has a hard edge: the catalogue
returns one page. `earth-search` serves up to 200 items per request and answers `limit=500` with an
HTTP 500. Past that you must follow the `next` link, which is a **cursor, not an offset**, so page
URLs cannot be computed in advance.

The way out is not a bigger page. It is a **smaller question**: search once per area, with that
area's own bounding box.

```sql
WITH aoi AS (
  SELECT name, geometry AS geom FROM read_parquet('/data/zones.parquet')
),
search AS (
  SELECT name, geom,
         http_get('https://earth-search.aws.element84.com/v1/search'
           || '?collections=sentinel-2-l2a'
           || '&bbox=' || ST_XMin(geom) || ',' || ST_YMin(geom) || ','
                       || ST_XMax(geom) || ',' || ST_YMax(geom)
           || '&datetime=' || $__timeFrom() || '/' || $__timeTo()
           || '&limit=200') AS r
  FROM aoi
)
```

`http_get` is a scalar function, so this is one request per row. Over six province-sized areas and a
30-day range that is six calls returning 28 to 77 items each — every one complete. The same range as
a single enclosing box matched 215 and returned 200: a sixteenth of the answer missing, silently.

A bounding box only ever **narrows**. A scene can touch an area's rectangle without touching the
area, so the spatial predicate still has work to do:

```sql
hit AS (
  SELECT * FROM scenes
  WHERE cloud_cover <= 20 AND ST_Intersects(geom, footprint)
)
```

## How much of each area is covered

The coverage figure is a ratio of areas, and it is worth computing twice:

```sql
SELECT name,
       -- what the best single scene gives you
       ROUND(max(m2(ST_Intersection(geom, footprint)) / m2(geom) * 100), 1) AS best_scene_pct,
       -- what you get by mosaicking every scene in the range
       ROUND(m2(ST_Intersection(any_value(geom), ST_Union_Agg(footprint)))
           / m2(any_value(geom)) * 100, 1)                                  AS coverage_pct
FROM hit GROUP BY name
```

The two are rarely close. Sentinel-2 ships on a 110 km grid, so anything province-sized straddles a
tile edge: measured over the Ecuadorian Amazon, the best single scene covered 47 % of the area while
the union of that fortnight's passes covered 100 %. **That gap is why "which scene should I use?" is
usually the wrong question.**

The same ratio is also the most useful **filter**, because a bounding-box search returns plenty of
scenes that only clip a corner. Over one province-sized shape, six of the seven scenes returned
covered under 10 % of it — noise in a table, and nothing you would want to look at:

```sql
hit AS (
  SELECT * FROM scenes
  WHERE ST_Intersects(geom, footprint)
    AND m2(ST_Intersection(geom, footprint)) / m2(geom) * 100 >= 10
)
```

::: danger always_xy is not optional
`ST_Transform` honours the authority's axis order, and EPSG:4326 officially declares **latitude
first**. Without `always_xy := true` your coordinates are silently swapped: a 9,846 km² area
measures 1,681 km², and anything past 90° west transforms to infinity and comes back `NULL`.

```sql
CREATE OR REPLACE TEMP MACRO m2(g) AS
  ST_Area(ST_Transform(g, 'EPSG:4326', 'EPSG:6933', always_xy := true));
```

The spheroidal shortcuts do not rescue you: DuckDB documents `ST_Area_Spheroid` as taking **X as
latitude**, so it agrees with the broken transform, digit for digit.
:::

## Which areas got nothing

The same join, inverted. An anti join lists the areas no usable scene touches:

```sql
SELECT a.name FROM aoi a
ANTI JOIN hit h ON ST_Intersects(a.geom, h.footprint)
```

An empty result is a real answer — everything was covered. Lower the cloud cut and the table fills
up, which over the Andes happens almost immediately.

## Draw the gap, do not just count it

A percentage tells you that 38 % of an area was covered. It does not tell you *which*
38 %. `ST_Difference` does, and the answer is a polygon you can put on the map:

```sql
gap AS (
  -- With no scenes at all the difference is NULL, and the whole area is the gap.
  SELECT name, COALESCE(ST_Difference(aoi_geom, seen), aoi_geom) AS geom
  FROM cov
)
SELECT name, CAST(ST_AsGeoJSON(geom) AS VARCHAR) AS geojson
FROM gap
-- A fully covered area differences to an empty polygon, and a GeoJSON with no
-- rings is not something to hand a map.
WHERE NOT ST_IsEmpty(geom)
```

Draw the **gap** rather than the covered part. What is covered is already on the map —
the footprints are right there — and kepler colours a layer as a whole, so shipping
"seen" and "unseen" in one dataset paints them identically and loses the distinction
that was the entire point.

## The catalogue as pictures

A scene id is not a picture. The tile server will cut your own area out of any scene it
can reach, so a table of scenes can carry a column of thumbnails — a few kilobytes each,
no download, no layer:

```sql
SELECT '<tiler>/cog/bbox/'
       -- Cropped to where the scene and the area actually meet, not to the area's
       -- own box: a mostly-transparent crop is a grey speck at thumbnail size.
       || ST_XMin(ST_Intersection(geom, footprint)) || ','
       || ST_YMin(ST_Intersection(geom, footprint)) || ','
       || ST_XMax(ST_Intersection(geom, footprint)) || ','
       || ST_YMax(ST_Intersection(geom, footprint))
       || '.png?url=' || url_encode(visual_href) || '&max_size=128' AS "View",
       strftime(acquired, '%d %b %Y  %H:%M')                        AS "Date"
FROM hit ORDER BY cloud_cover
```

Set that field's cell type to **Image** in the table's field overrides. Two details make
the difference between a column of pictures and a column of broken icons:

- **`url_encode` the asset link.** It survives unencoded today, but a signed URL carries
  a query string of its own and would be parsed as parameters of the tile request.
- **Emit the date as text**, not as a `TIMESTAMP`. Grafana renders a timestamp in the
  viewer's zone, and a pass at 19:00 UTC changes day on the way to the screen.

### Clicking a thumbnail, without disturbing anything else

The obvious wiring is a data link that sets the dashboard's time range around the
acquisition. It works, and it is too blunt: narrowing the clock to ten minutes recomputes
every figure on the dashboard and empties the very table you clicked in.

Two channels do it properly, and neither costs a line of plugin code.

**Move the map** with the centre mapping's *read-back* direction. Declare it on the panel:

```json
"variableMappings": [
  { "source": "center", "variable": "lat", "variableTo": "lng", "zoom": 8 }
]
```

Anything that writes that pair from outside the map — a data link, a textbox, a shared URL
— moves the viewport there. Without `zoom` the map keeps the scale it has. Give the row
the centre of **what the thumbnail shows**, not of the whole area:

```sql
ST_Y(ST_Centroid(ST_Intersection(geom, footprint))) AS centre_lat,
ST_X(ST_Centroid(ST_Intersection(geom, footprint))) AS centre_lng
```

**Draw that scene** by taking the link away from the others. Rows with no usable url are
skipped when the catalogue is read, so gating the column leaves exactly one scene while
every row — and any layer drawn from it — stays exactly as it was:

```sql
CASE WHEN getvariable('picked') IS NULL OR visual_href = getvariable('picked')
     THEN visual_href END AS raster_url
```

::: danger Do not also give that frame a time field
A `TIMESTAMP` column makes the frame a **dated** catalogue, and then the map's clock is a
second scene picker competing with your table. When they disagree — you click a scene the
current window does not contain — the panel resolves it by **hiding the layer**: the scene
arrives in the layer list with its eye shut, and nothing is drawn.

That is deliberate for playback, where a window between two captures is a passing state and
dropping the layer would cost the user their styling. It is the wrong contract when
something else is doing the choosing. Emit the date as **text** instead — the time role is
detected by field type, never by name — and the catalogue becomes undated, the clock stops
competing, and the picked scene is always the one drawn.
:::

Then the link carries `${__url_time_range}` — which *preserves* the range rather than
setting it — plus the coordinate and the scene. Enumerate the other variables explicitly;
a link that forgets one silently resets it to its default.

::: warning Grafana caps the row height
`cellHeight` offers `sm`, `md` and `lg` and nothing larger, so thumbnails land around
30 px however wide you make the column. Cropping to the intersection is what keeps them
legible at that size.
:::

## One scene is drawn, not all of them

A query returning many rows with a `raster_url` describes a **catalogue**, and exactly one
scene is drawn from it. The other footprints are drawn as geometry; their imagery is not.
A table of ten scenes is a choice still to be made, never ten layers to stack.

Which one gets drawn depends on whether the frame is **dated**. With a time field, the
map's clock picks the most recent scene inside its window — that is what makes a daily
series walkable. Without one, the first row wins, so the query's `ORDER BY` is the choice.

So an area whose footprints form a grid shows imagery in **one** cell of that grid. That
is the design, not a bug — but it surprises everyone once.

::: tip A server-side mosaic is possible, and rarely worth it
TiTiler's `/mosaicjson` router will composite many COGs into one tile, and
`pixel_selection=lowest` both fills the gaps and suppresses a good deal of cloud. It
cannot *build* the mosaic, though — the only POST it offers is `/validate` — so you
generate the MosaicJSON yourself and host it where the server can fetch it.

The cost is the reason to think twice. Measured over 28 Sentinel-2 scenes, warm: **2.6 s
per tile** for `first`, **3.9 s** for `lowest`, **4.7 s** for `median`, against **0.07 s**
for a single COG. That is fine as a build step — bake the result into
[PMTiles](../data/rasters) once — and painful at draw time, where a dozen tiles per pan
queue behind one another.
:::

## From the catalogue to the ground

The join ends with a link to a file. The `raster` extension reads that file **where it lives**, over
byte ranges, and measures it inside your polygon — no download, no ETL. Three things have to line up
first, and each one costs an iteration to discover:

```sql
INSTALL raster FROM community; LOAD raster;
-- 1. GDAL looks for certificates at a RedHat path; the Grafana image is Ubuntu.
SELECT RT_GdalConfig('CURL_CA_BUNDLE', '/etc/ssl/certs/ca-certificates.crt');

-- 2. RT_Read demands a literal path at bind time, so the chosen scene goes through a variable.
SET VARIABLE scene_asset = (SELECT '/vsicurl/' || red_href FROM pick);

WITH tiles AS (
  -- 3. Without OVERVIEW_LEVEL this reads native 10 m across a 110 km swath and the panel expires.
  SELECT geometry, tile_x, tile_y, metadata, databand_1 AS band
  FROM RT_Read(getvariable('scene_asset'), open_options := ['OVERVIEW_LEVEL=3'])
)
SELECT round((RT_CubeStats_Agg(cube, 0)).mean, 1) FROM …
```

Measured against a Sentinel-2 red band over an 8,861 km² area: **over 67 seconds and a timeout** at
native resolution, **8.4 seconds** reading overview level 3, still 131,520 valid pixels — far more
than a mean needs.

::: warning The tiles come back in the scene's own CRS
`RT_Read` yields tile geometries in the raster's projection, which for Sentinel-2 is a UTM zone, and
`ST_Intersects` refuses to mix coordinate systems. Transform the clip polygon on its way in — and let
the catalogue tell you where to send it, because `proj:epsg` is one of the columns you already have:

```sql
ST_Transform(ST_Intersection(geom, footprint),
             'EPSG:4326', 'EPSG:' || proj_epsg, always_xy := true) AS clip
```
:::

## Two things that will bite you anyway

**Cast the GeoJSON.** The data source's Go driver cannot scan DuckDB's JSON type, so every geometry
leaving a query needs `CAST(ST_AsGeoJSON(g) AS VARCHAR)`. See
[Geometry](../data/geometry).

**Do not quote your variables.** Grafana quotes them for you, so a drawn area is
`ST_GeomFromText($aoiArea)` and never `ST_GeomFromText('$aoiArea')`. See
[Variables: do not quote them](./duckdb-geoparquet#variables-do-not-quote-them). Guarding the empty
case is easiest through a variable:

```sql
SET VARIABLE drawn = nullif($aoiArea, '');
```

## Provisioned dashboard

**From the sky to the ground — exploring a STAC catalogue** on the sources bench is the drawn-area shape of
this: one catalogue search answers for exactly the polygon on the map. It opens with a shape already
drawn — a feature parked in the saved config's `visState.editor.features`, with the same WKT as the
area variable's default, because the panel only ever *adopts* a restored figure and never publishes
it. Move it, reshape it or delete it and every panel follows. The map draws the chosen scene over a satellite basemap, with the
coverage gap outlined around it; a row of figures reports scenes, cloud, coverage and best-scene; a
and a contact sheet shows the catalogue as pictures of your area, each row clickable to fly the map
to that scene and draw it. A drawn area answers in about a second.

It does **not** measure the imagery. The section above shows how, and it is deliberately left out
there: the reading is the one cost that grows with the size of what you draw — around a second for
a small overlap, 8 s for a province-sized one, and a timeout at native resolution — which is the
wrong shape for a panel that should answer while you are still drawing.

The multi-area pieces above — the pushdown across a table of zones, and the anti join that finds
the ones nobody photographed — are the same SQL against `read_parquet` instead of a drawn polygon.
They are not in that dashboard, which deliberately tells one story well rather than two at once. Run it with `npm run server:sources`
and open the `:3002` bench — see [Developing the plugin](../../contributing).

## When this is the wrong tool

This is a single node. It suits catalogue questions at the scale of a dashboard — dozens of areas,
hundreds of scenes, answered in seconds. Sweeping a planetary archive in batch is what
[Apache Sedona](https://sedona.apache.org/) and a cluster are for; the SQL looks almost identical,
which is the point, but the machine underneath is not.
