# Time range sync

**Time range sync** decides how the dashboard's time picker and the map's own time filter relate.
There are four modes, and each of the last three exists to avoid a specific failure the others walk
into.

| Mode                               | Direction       | Dashboard queries re-run?    |
| ---------------------------------- | --------------- | ---------------------------- |
| **Dashboard drives map** (default) | picker → map    | no                           |
| **Both directions**                | picker ↔ map    | yes, when the map moves      |
| **Slider writes variables**        | map → variables | only the panels reading them |
| **Off**                            | neither         | no                           |

All four need a time column for anything to happen. A query with no temporal column has no time
filter to couple to, and the setting is inert — which is why the layer gallery dashboard sets it
`off` on the twelve panels that have no time.

## Dashboard drives map

The default, and the right answer most of the time. Change the dashboard time range and the map's
time filter follows.

The map's own query is re-run by Grafana as usual, so the data narrows too. Nothing is pushed the
other way: dragging the map's time brush filters the map and leaves the dashboard alone.

## Both directions

Adds the reverse: dragging the map's time brush moves the **dashboard** time range, so every panel
on the dashboard follows the map.

This is genuinely useful for a dashboard whose map is the primary control. It has a real cost:

- **Every query on the dashboard re-runs** on every change. Playing an animation in this mode is a
  stream of them — 92 queries in ten seconds, measured on a two-panel dashboard.
- **The map filters its own data.** A narrower range means the map's own query returns fewer rows,
  so the histogram under the time slider rescales as you drag it, and rows outside the window leave
  the browser. Widening the brush again cannot bring them back — the dataset no longer holds them.

That second point is a ratchet, and it is why the third mode exists.

## Slider writes variables

The map's time brush is published to **two dashboard variables** instead of moving the dashboard
range. Consuming panels read the variables; the dashboard range never moves.

This gets you the coupling without the ratchet. The map's own query keeps using `$__timeFilter` over
the full dashboard range, so its dataset is never invalidated by its own brush: the histogram stays
whole, and the brush stays a pure mask over data that is all still there.

Configuration and the exact value format are on
[Time window variables](./time-window-variables).

::: tip When to pick this over "Both directions"
Whenever the map holds a lot of data and the point of the brush is to explore it. A month of
seismicity, a day of vehicle traces, any dataset where you want to scrub back and forth. "Both
directions" is for the case where the map is a coarse control and the other panels are the payload.
:::

There is one behavioural difference worth knowing: in this mode the filter is **seeded with the
data's own extent** rather than with the dashboard range. The time widget opens showing everything,
which is what leaves room for the brush to mean something. Seeding it from the dashboard range
would put the brush across the whole histogram at once, with no context left to reveal.

## Off

The map's time filter and the dashboard time picker are independent. The query still respects the
dashboard range in the ordinary Grafana way — `$__timeFilter` is your SQL, not the panel's — but the
kepler filter is yours to drag.

Use it when the panel has no time column, or when a map is deliberately showing a fixed period
regardless of what the dashboard is set to.

## Sharing time between maps instead

None of these four modes talks to the _other maps_ on the dashboard except through the dashboard
range. If what you want is two maps animating together, see
[Peer time sync](./peer-time-sync) — it passes the clock between panels in the browser and asks the
database nothing.
