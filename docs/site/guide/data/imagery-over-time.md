# Imagery over time

Imagery is rarely a single picture. A satellite passes every few days, a rainfall product publishes
a file a day, a weather service renders an image an hour — and the question is almost never "what
does it look like" but "what did it look like **then**".

The map's time widget answers that. Whichever of the three paths you took —
[a COG, an archive](./rasters) or [a WMS](./wms) — the clock at the bottom of the map becomes the
scene selector, and dragging it changes the picture without re-running your query, rebuilding your
layer, or moving the frame you are looking at.

## Give the query one row per date

For a raster, that is the whole configuration. Return a **time column** alongside the URL and the
query stops being an answer and becomes a small catalogue:

```sql
SELECT captured_at AS "time", scene_url AS raster_url
FROM scenes
WHERE captured_at BETWEEN $__timeFrom() AND $__timeTo()
ORDER BY captured_at;
```

The time widget now shows a bar per capture and draws the scene the window selects. The rows are
also an ordinary dataset, so the same query gives you the calendar as a table beside the map.

For a WMS the dates can come from the query the same way — or from the service, which is usually
better. See [Where a WMS gets its calendar](#wms-calendar) below.

## Which scene a window selects

**The most recent one inside it.** Not the nearest one.

That is a real decision, and it is the one that makes dragging the end of the slider back through
the calendar mean what you expect: it shows what was on the ground at that moment. An image captured
_after_ the moment was not, however close it falls.

Two edges follow from it:

- **No window at all** — the newest scene there is, which is what a map should open on.
- **A window containing nothing** — no scene, which is a real state and not an error. The satellite
  did not pass in those days; the service has no picture of that hour.

::: tip An empty window hides the layer, it does not remove it
Playback crosses gaps — a sixty-day rainfall series has days without a file, and every loop of the
animation runs through them. Dropping the layer and rebuilding it on the far side would hand back a
new layer with default styling every time, which reads as "my styling resets itself while it plays".
So the layer is hidden and comes back as you left it.
:::

## The picture changes; the layer does not

Dragging the clock does not go back to the database. The catalogue is already in the browser, so
what happens is a change to the layer that is already drawing — and the difference between the three
paths is worth knowing, because it is the difference between them anywhere:

| Path        | How the new date reaches the picture             | What it costs                       |
| ----------- | ------------------------------------------------ | ----------------------------------- |
| **COG**     | the layer is re-pointed at the new scene in place | tiles for the new scene             |
| **PMTiles** | the layer is rebuilt against the new archive      | tiles for the new archive           |
| **WMS**     | the date travels as a parameter on the next request | **one image**                     |

In all three the layer id, its name and everything you styled on it survive the change. In none of
them is your query re-run or the map re-framed.

The one asymmetry is why PMTiles rebuilds rather than re-points: kepler's archive path gives deck.gl
no way to learn that its tiles have expired, so re-pointing one would leave the first date on screen
for every date after it — a failure with a convincing disguise, because the network shows requests
against the new file (its header and directory) and never a tile. The rebuild keeps the layer and
its styling; it just costs a fresh tile source per scene.

And for a WMS specifically: a drag that stays between two dates asks for nothing at all.

## The previous picture stays until the new one has drawn

Scene changes hand over rather than cut. The old imagery keeps drawing while the new tiles are
fetched and refined, so the map never goes bare mid-drag — which matters most exactly when it is
least convenient, animating across a series over a slow link.

## Where a WMS gets its calendar {#wms-calendar}

Many time-aware services publish one image per day or per hour and expect a `TIME` on the request.
The dates can come from either side:

- **From the query.** Return one row per date alongside the service and layer, and those dates are
  the timeline. Use this when you want a subset, or a calendar assembled from somewhere else.
- **From the service.** Return no time column at all, and the panel reads the layer's
  `<Dimension name="time">` out of the service's own `GetCapabilities`. This is the one that keeps
  working by itself: a server gains a new pass every day, and no hand-written calendar stays in step
  with that.

**The query wins when both exist** — a query that says which dates matter has said something the
service cannot know.

Either way the dates become a small dataset of their own, `grafana-<refId>-wms-times`, one row per
date, and you will see it in the data table beside your own rows. That is not an accident of the
implementation: kepler's time filter is always a filter **on a column of a dataset**, so the calendar
has to be on the map for the widget to exist at all.

Two limits of a service-published calendar:

- An extent longer than **two thousand instants** keeps its **newest** end. GeoGLOWS' hourly layers
  list fourteen thousand dates; a legal extent like `2016-01-01/2026-01-01/PT1S` is three hundred
  million, and expanding it whole would be a browser that never comes back.
- An extent that cannot be read yields **nothing** rather than a guess. `current` is legal in some
  deployments, and inventing dates for it would put a timeline on the map that the service answers
  with empty pictures.

## Do not couple it through dashboard variables

The obvious design — publish the map's window to a variable, have the imagery query read it — does
not work, and the way it fails is expensive to diagnose.

Moving the window re-runs **every query on the panel**, including the one that feeds the time filter.
That query returns, the filter is rebuilt, the window is republished, and round it goes. Measured,
not theorised.

The clock walks the catalogue **in the browser** precisely so that it does not have to ask anything.
Leave [Time range sync](../dashboard/time-range-sync) doing what it does — bounding which scenes the
query fetches at all — and let the widget choose among them.

::: tip A window that advances by itself is not a loop
If it moves at a constant width, that is the animation playing. A stray click on the play button
starts it, and it looks exactly like a feedback loop until you notice the width never changes.
:::

## Playing it

The widget's play button animates imagery the same way it animates rows, which for a daily series is
the most direct way to see it — press play and watch a season pass.

The [Time range sync](../dashboard/time-range-sync) mode matters as much here as it does for
trajectories, and for the same reason: in _Both directions_, every step of the animation re-runs
every query on the dashboard. For imagery that is doubly wasteful, since the scenes it would fetch
are already in the browser. See [Time playback](../kepler/time-playback).
