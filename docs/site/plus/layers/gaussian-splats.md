# Gaussian Splats

A scan of Gaussian splats on each row's place: the photographic 3D a phone, a drone or a scanner captures of a room,
a façade, a monument or a works site, trained into splats. Each row places one scan on the map, turned to the north
and standing on the ground; a click flies to it, or puts the camera inside it at eye height, and a card above it can
show its readings.

::: info Since Plus 1.7.0
The Gaussian Splats layer is new in Plus 1.7.0, not released yet.
:::

A tileset of splats, as ArcGIS and Cesium serve a city or a site in tiles, is drawn by the free panel's
[3D Tile layer](/layers/url-configured#gaussian-splats) instead. This layer is for single scans, the files a capture
app or a trainer exports.

## What the query needs

One row per scan, with its place:

| Column              | Unit               | Notes                                                                    |
| ------------------- | ------------------ | ------------------------------------------------------------------------ |
| latitude, longitude | degrees            | where the scan stands; picked like any point layer's coordinates         |
| altitude            | metres             | optional: lifts the scan, as a point layer's altitude column does        |
| splat_url           | an address         | the row's own scan; or one **Scan URL** for every row                    |
| heading             | degrees from north | optional: turns this row's scan, over the layer's **Heading**            |
| scale               | metres per unit    | optional: this row's scale, over the layer's **Scale**                   |
| pitch, roll         | degrees            | optional: set this row's scan level, over the layer's **Pitch**/**Roll** |
| anything else       |                    | shown in the popup, and filtered by kepler's filters                     |

```sql
-- Two captures of the same courtyard, a year apart: a time filter on captured_at picks the one shown.
SELECT 'Courtyard'      AS label,
       -2.8974          AS latitude,
       -79.0045         AS longitude,
       url              AS splat_url,
       captured_at,
       112              AS heading
FROM scans;
```

Name the coordinate columns `latitude` and `longitude`: kepler renames columns called `lat` and `lng` as it loads
them, and a saved layer that names them then finds none. A Gaussian Splats layer is never created by itself: add one
with **Add Layer** and pick **Gaussian Splats**, or switch a point layer to it.

## The scan

**Scan URL** is the scan every row draws, unless the row names its own in the **Scan URL column** (**Auto** takes a
column named `splat_url`, `scan_url`, `splat`, `scan` or `url`; **None** uses the Scan URL for every row). A scan is
an `https://` address, served with CORS for your Grafana's address, or a file of the plugin; any other address is
refused, since every viewer's browser fetches it. Each scan is fetched once per page, however many rows, layers and
panels draw it.

The layer reads:

| Format   | From                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| `.spz`   | Niantic's compressed splats: Scaniverse, Spark, most web exports                           |
| `.ply`   | 3D Gaussian Splatting's own output, binary, as trainers write it (Postshot, Brush, gsplat) |
| `.splat` | the format of antimatter15's web viewer                                                    |
| `.glb`   | a glTF with the `KHR_gaussian_splatting` extension, plain or SPZ-compressed                |

SuperSplat's compressed `.ply` is not read: export a plain `.ply` or an `.spz` from it. A scan is drawn with up to 16
million splats and 600 MB; past that, the map says so and leaves it out.

## Placement

No capture knows where north is, and most do not know which way is up. The **Placement** group stands the scan on the
map:

- **Up axis**: which way the file holds up. **By format** takes Y up for a `.glb` (glTF's frame) and Y down for
  `.spz`, `.ply` and `.splat`, the frame trainers write them in. A scan lying on its side or upside down needs another
  choice.
- **Pitch (°)** and **Roll (°)** set a crooked capture level: the pitch raises its front (its north, before the
  heading), the roll lowers its right side.
- **Heading (°)** turns the scan clockwise from north about its place.
- **Scale** is how many metres a unit of the file is: 1 for a metric or georeferenced capture.
- **Altitude (m)** lifts the scan, over the row's altitude column.
- **Floor on the ground**, on by default, stands the scan on its lowest splats (the 2nd percentile of their heights,
  past the few strays a capture leaves under the floor). Off, the file's origin stands at the place.

On a base map with relief the scan stands on the ground under its place.

## How it is drawn

Each splat is drawn as the soft ellipse it covers on the screen, back to front, as the scan was trained, so the splats
blend into a photographic surface. Scans write no depth: a nearer scan hides the one behind it, the base map's
buildings in front of a scan hide it, and a scan never hides kepler's layers drawn after it.

- **Opacity** sees through the whole scan, not each splat: at 0.5 what stands behind the scan shows through it.
- **Colour by view angle**, on by default, draws the shine and tint a splat shows from each side, as the scan was
  trained (its spherical harmonics, up to degree 3), from `.spz`, `.ply` and `.glb`; `.splat` carries none. A scan
  whose harmonics would take more than 256 MB of GPU memory keeps one colour a splat. Off draws every splat with one
  colour, a little faster.
- **Soften fine splats**, on by default, dims splats finer than a pixel for scans trained with a screen-space filter
  (most `.spz` from capture apps). Off draws them as other viewers do.

Zoom close to stand in a scan with the panel's [Maximum zoom](/guide/kepler/map-settings#how-close-you-can-zoom),
up to 24.

## A click on a scan

**On click**, in the **Camera** group, says what a click on a scan does with the map:

| Setting                         | The camera                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| **Fly to the scan**             | flies to the scan, in the middle of the map and about half its height, keeping the bearing |
| **Stand inside, at eye height** | stands at the scan's middle, **Eye height (m)** over its floor (1.6), tilted to look level |
| **Nothing**                     | stays where it is                                                                          |

**Stand inside** is for a room, a courtyard or a site seen as a visitor would. It is a place to look from, not a walk:
the map moves as usual from there. On an object scanned from outside, the camera ends up inside the object. A click
needs **Allow hover** on in the **Interaction** group; the popup shows the row's fields, as on any layer.

## Cards

The rows that share a scan's URL and its place are that scan's readings: a room's temperature every hour, a works
site's progress every week. The scan is drawn once, and the **Cards** group (see [Cards on any layer](./cards)) shows
a card above it with their series, its value at the map's instant and its alerts:

```sql
-- Each room's scan, with its air readings: one card per room, above its scan.
SELECT r.name AS label, r.latitude, r.longitude, r.scan_url AS splat_url,
       a.time, a.temperature
FROM rooms r JOIN air a ON a.room = r.id
WHERE a.time BETWEEN $__timeFrom() AND $__timeTo();
```

The card stands above the top of the scan once the scan has loaded.

## A scanned building, floor by floor

With the panel's [Floors](/plus/indoor/) on, a scan is cut at the floors shown: what lies above them (and below,
unless **and below** is ticked) is left out, a section through the building, whether the other floors are seen
through or hidden. **Cut at the floor shown**, in the **Placement** group, turns it off.

- Give the scan's query **no floor column**: a scan is one row on every floor. The sensors, rooms and plans have
  theirs, as for any indoor map.
- Set Floors' **Spread** to the building's storey height, so that its floors' heights match the scan's: each floor
  is drawn from half a metre under it to half a metre under the next.
- Stand the scan's ground floor on the ground (**Floor on the ground**), or lift it with **Altitude** to where the
  building's floor 0 is.

## Picking a capture by time

The rows kepler's filters drop are not drawn. With one row per capture and a time column, a time filter (or the
[Time Brush](/plus/time-brush)) shows the capture of the moment: a works site week by week, a façade before and after
its restoration.
