# Time Brush

One time brush for the whole dashboard. **Time Brush Plus** is the second panel of the Plus app: a histogram of
its own query with a window to drag, resize or draw, buttons to jump and to step, and a play that walks the window
across the range. The window reaches the other panels as two dashboard variables, or as the dashboard time range.
Once the panel scrolls out of view, the bar pins to the top of the page.

It exists because the map's own time widget, kepler's, takes a good share of the panel and talks only to its
map. The brush lives in a panel of its own, as tall as you like, and every panel on the dashboard can follow it.

## Setting it up

1. Add a panel and pick **Time Brush Plus**.
2. Give it a query with a time column: the sum of each numeric field per bucket draws the histogram, or the
   rows per bucket when the query has no number. An aggregate is enough; it is a picture, not the data.
3. Under **Time window**, choose where the window goes:
   - **Variables**: two text variables, `t0` and `t1` by default, written as UTC ISO 8601. The map panel's
     [Slider writes variables](/guide/dashboard/time-range-sync#slider-writes-variables) reads and writes the
     same pair, so a map set to that mode follows the brush, and the brush follows the map, with no other
     change. Every other panel reads them as
     [Time window variables](/guide/dashboard/time-window-variables) explains.
   - **Dashboard time range**: the window is the dashboard's own range, so every panel follows and every query
     re-runs on each change. Give the brush panel a wider **Relative time** under _Query options_ (a week over a
     dashboard showing an hour): the brush spans that, and the dashboard range is the window drawn on it.

## The bar

| Control           | What it does                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| « »               | Move the window to the start or the end of the range, keeping its width.                                                             |
| ‹ ›               | Move it one bucket back or forward.                                                                                                  |
| Play / Pause      | Walk the window across the range in the chosen mode and speed.                                                                       |
| Select everything | Widen the window to the whole range.                                                                                                 |
| Window mode       | **Free** slides a window of fixed width; **Incremental** keeps the start and grows the end; **Interval** walks one bucket at a time. |
| Speed             | ¼× to 8× of **Step every**.                                                                                                          |

On the histogram, drag inside the window to move it, drag a handle to resize it, or drag the empty bar to draw a
new one. When the window already covers everything, a drag anywhere draws a new one; Shift and drag draws from
anywhere at any time. A click on the empty bar picks the bucket under it while the window snaps to buckets, and
means nothing otherwise.

## Buckets

One size rules three things: the bars of the histogram, the snap of the window's edges, and the length of a step.
**Bucket** is `auto`, about eighty buckets across the range on a round interval, or an interval of your own such
as `15m`, `1h` or `1d`. **Snap the window to buckets** is on by default, so a window always counts whole bars.

## Playing

A play moves the window one bucket every **Step every** milliseconds, at the chosen speed, and stops at the end
unless **Loop** is on. **Write while playing** decides whether the other panels follow as it runs: on by
default, with the window written at most once per **Least time between writes**, and, when the DuckDB-WASM
datasource from the Grafana Geospatial Stack is on the page, only after the panels answering the previous write
have settled, the same pacing the map panel uses for its own playback. Off, the window reaches the dashboard
where the play stops.

**Follow the latest data** keeps the window's end on the newest moment as the dashboard refreshes, for a live
feed.

## The pinned bar

With **Pin to the top when scrolled past** on, the bar is drawn over the page from the moment the panel leaves the
view until it comes back, and everything on it works there: drag, step, play; an arrow at its right scrolls the
page back to the panel. **Pinned bar goes** chooses where:

| Position     | Where it is drawn                                                                       | When                                  |
| ------------ | --------------------------------------------------------------------------------------- | ------------------------------------- |
| **Top**      | Under the bars Grafana keeps fixed, where the panel was across the page.                | Once the reader has scrolled past it. |
| **Bottom**   | At the foot of the page, where the panel was across it.                                 | Whenever the panel is out of view.    |
| **Floating** | Wherever the reader drags it by the grip at its left; the grip at its right resizes it. | Whenever the panel is out of view.    |

A floating bar first opens where a top bar would, and remembers where it was left in this browser, per
dashboard and panel. **Space from the edge** adds room under Grafana's own top bars or above the bottom of the
page. **Pinned bar carries** keeps everything or only the buttons and the readout, **Pinned histogram height**
sets how tall its bar is, and **Pinned bar background** is solid or translucent over the panels scrolling under
it.

## Appearance

| Option                        | What it sets                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Window colour                 | The window's fill, border and handles. Empty: the theme's primary colour.     |
| Shared cursor colour          | The cursor's line. Empty: the theme's warning colour.                         |
| Bars                          | A colour per series, from the standard colour options, or one colour for all. |
| Bars outside the window       | How visible they stay, in percent.                                            |
| Time axis                     | The dates under the histogram.                                                |
| Window mode and speed pickers | The two pickers at the right of the toolbar.                                  |
| Density                       | Comfortable, or compact for a bar in a short panel.                           |

## The shared crosshair

With the dashboard's **Graph tooltip** on _Shared crosshair_ or _Shared tooltip_, hovering the histogram moves the
cursor of every Time series and of every map showing its [temporal cursor](/guide/dashboard/temporal-cursor),
and a cursor from a graph is drawn on the histogram as an amber line. Dragging publishes nothing: the pointer is
moving the window, not asking about a moment. Both directions have a switch under **Shared cursor**.

## Shade the window on the graphs

The window is two variables, so an annotation can draw it as a region on every Time series, as
[Time window variables](/guide/dashboard/time-window-variables#shade-the-window-on-the-graphs) shows. The
provisioned **Time brush** dashboard of the development bench does exactly that over three random walks.

## What it does not do yet

- It does not move a Trip layer's playhead; that clock still belongs to the map.
- The histogram is a sum or a count per bucket. A line chart of a measure, as kepler's time widget can draw, is
  not there yet.
- Variables are written from the URL, so a dashboard in kiosk mode without URL sync does not carry them.
