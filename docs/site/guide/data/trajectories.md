# Trajectories

Give each row a **trip id**, a **time** and a **position**, and the panel groups the points into
paths and builds an animated Trip layer with a playback timeline. No layer configuration.

```sql
SELECT vehicle_id AS trip_id,
       ST_Y(geom)  AS latitude,
       ST_X(geom)  AS longitude,
       ts          AS time
FROM vehicle_positions
ORDER BY vehicle_id, ts;
```

<video src="/img/guide-trips.mp4" poster="/img/guide-trips.jpg" autoplay loop muted playsinline controls aria-label="An animated Trip layer playing back: one participant's trail drawn along the streets as kepler's clock runs, coloured by speed" style="width:100%;height:auto;border-radius:8px"></video>

## The three columns that make a trip

All three are required — two of them is not a trajectory:

| Role                 | Detected from                                                                           | Notes                    |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| Trip id              | `trip_id`, `tripid`, `track_id`, `trackid`, `trajectory_id`, `vehicle_id`, `journey_id` | groups the points        |
| Time                 | any column the data source typed as time                                                | orders them              |
| Latitude / longitude | the usual names                                                                         | positions them           |
| Altitude             | **nothing** — see below                                                                 | optional third dimension |

Miss any of the first three and you get a plain point layer instead, which is a useful diagnostic:
if you expected animation and got dots, one of the three was not recognised.

## Why the panel builds this layer and kepler does not

kepler has its own Trip layer detection, but its heuristic insists on a column literally named
`id`. Real trajectory tables call it `vehicle_id`, `trip_id`, `imei` or `device`. So the panel emits
the layer configuration itself — in kepler's saved-config shape, so kepler parses it rather than
trying to use it verbatim.

## Altitude is opt-in, on purpose

The altitude role has **no detected column names at all**. That is not an oversight.

GPS traces routinely carry an `elevation` column holding metres above sea level, and deck.gl reads a
path's third coordinate as **height above the ground**. A trail through Cuenca at 2,650 m would be
drawn 2.65 km up — so it looks perfectly fine zoomed out, and vanishes the moment the camera
descends below it, at roughly zoom 15. That reads as a rendering bug rather than as a mapping
choice, which is exactly the wrong failure to hand someone.

So height on a trip path is opt-in: map it yourself under **Field mapping → Altitude** when you
actually want a 3D path, and be aware you are asking for height above terrain, not elevation.

## Table columns or GeoJSON

**Trip layer** in the panel options picks between kepler's two Trip layer shapes. The default is the
right answer almost always.

|                               | Table columns (default) | GeoJSON        |
| ----------------------------- | ----------------------- | -------------- |
| Rows                          | one per GPS ping        | one per trip   |
| Columns kept                  | **all of them**         | only the path  |
| Colour by speed, mode, driver | yes                     | no             |
| Filter on a per-point column  | yes                     | no             |
| Tooltips                      | full row                | nothing useful |
| Payload size                  | full                    | far smaller    |

`table` mode hands kepler the rows as they come and lets it group them by id, so `speed_kmh`,
`mode_of_transport` and everything else stays available for colour, filters and tooltips.

`geojson` mode folds every ping of a trip into a single row carrying a LineString whose coordinates
are `[lng, lat, alt, timestamp]`. Everything that was not one of those four is discarded — that is
the trade you are making. It is worth making when all you want is the animated line over a very
large number of points, and it is also the shape older saved map configurations point at.

## What the folding does

In either mode the points are **sorted by time within each trip**, because queries rarely guarantee
order and an unordered path draws as a scribble. Trips with fewer than two points are dropped, since
a line needs two. Points missing a coordinate or a timestamp are skipped rather than poisoning the
whole line with a null.

Sorting in SQL as well is still worth doing — `ORDER BY vehicle_id, ts` — because it makes the data
legible when you inspect it in a table panel beside the map.

## Playback

A Trip layer gives you kepler's playback timeline at the bottom of the map: play, pause, speed, and
a scrubber. **Trail Length** in the layer settings decides how much of the path stays visible behind
the moving head — short reads as a comet, long reads as the whole route drawing itself.

The playhead couples to the dashboard in three different ways, covered in
[Time range sync](../dashboard/time-range-sync), and it can be shared with the other maps on the
dashboard without touching the dashboard time range at all — see
[Peer time sync](../dashboard/peer-time-sync).

## Drawing a trajectory table as points instead

Sometimes you want the pings, not the paths. Set **Field mapping → Trip ID → None**.

This is why the editor has a `None` entry rather than just an empty field: clearing the field would
hand the role back to autodetection, which would find `vehicle_id` again and rebuild the trips.
`None` switches the role off outright.
