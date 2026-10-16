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
3. Under **Write the window to**, choose where the window goes:
   - **Variables**: two text variables, `t0` and `t1` by default, written as UTC ISO 8601. The map panel's
     [Slider writes variables](/guide/dashboard/time-range-sync#slider-writes-variables) reads and writes the
     same pair, so a map set to that mode follows the brush, and the brush follows the map, with no other
     change. Every other panel reads them as
     [Time window variables](/guide/dashboard/time-window-variables) explains.
   - **Dashboard time range**: the window is the dashboard's own range, so every panel follows and every query
     re-runs on each change. Give the brush panel a wider **Relative time** under _Query options_ (a week over a
     dashboard showing an hour): the brush spans that, and the dashboard range is the window drawn on it.
4. **Select** _A window_, with a start and an end, or _An instant_, written to one variable (**Instant
   variable**): a playhead for a picture per date, or a position at one moment.

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
anywhere at any time. A click on the empty bar picks the bucket under it while the window snaps to buckets or marks, and
means nothing otherwise.

## Buckets

One size rules three things: the bars of the histogram, the snap of the window's edges, and the length of a step.
**Bucket** is `auto`, about eighty buckets across the range on a round interval, an interval of your own such as
`15m`, `1h` or `1d`, or a dashboard variable such as `$bucket`: then the size is the dashboard's, a filter or another
panel's cross-filter sets it, and the queries can use it too. A **bucket menu** on the bar changes it on the fly,
automatic or a year down to a second; a size too fine (more than 2,000 buckets) or too coarse (fewer than two bars)
for what the axis shows falls back to the automatic one, and the menu offers it disabled. `1M` is a month and `1m` a
minute.

**Snap to** keeps the window on whole _Buckets_ (the default), on the _Marks_ of a series drawn as marks, or on
_Nothing_.

## Series and marks

The sum of each numeric field per bucket draws the histogram, or the rows per bucket when the query has no number.
Each series is drawn as **bars, a line, an area or marks**, from its field's options (**Draw as**), so overrides give
one query bars and another a line. **Per bucket** reduces its rows by sum, mean, min, max, last or count; _Auto_ sums
bars and averages lines and areas. A **context** series is drawn in grey behind the others, unstacked: the whole,
beside what the dashboard's filters leave.

A series drawn as **marks** puts a tick at each of its times, such as the dates an imagery catalogue has. The window
or the instant can snap to them, step between them and play through them, and **Choose by date** on the bar drills
down over the times that exist, years then months, days and times, skipping any level with one choice. Without
marks, it offers date and time inputs.

## Zooming the axis

Ctrl or ⌘ and the wheel zoom about the pointer; Shift and the wheel, or a sideways wheel, pan; the buttons and the
`+` and `-` keys zoom about the window. A strip under the axis shows the whole range, where the view is (drag it)
and where the window is, and the automatic bucket follows the zoom. **The brush spans** the dashboard's _Time range_
or _The data_. **View start variable**, **View end variable** and **Bucket variable (seconds)**, when named, carry the
view's bounds and bucket, so the panel's own query can be asked again at the resolution being looked at.
**Zoom to a window set from outside**, off by default, brings the axis to a window that a link, another panel or
the time picker sets, with a quarter of its width either side, so a day set from a chart is not a sliver of a long
axis; it keeps that frame, through a move of the dashboard range that came with the window, until you zoom, pan or
move the window yourself. A link that carries the view opens on its view instead.

## Keys

On the brush, the arrows move the window one bucket, Shift and an arrow move its end, Home and End jump to the start
and the end, Space plays, Escape stops and A selects everything.

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

**Pin the bar to the page** decides whether the bar leaves the panel: **Never**, **When scrolled past**, or
**Always**. When it does, it is drawn over the page and everything on it works there: drag, step, play. With
_When scrolled past_ it leaves once the panel is out of view and comes back with it, and an arrow at its right
scrolls the page back to the panel; with _Always_ it is on the page from the moment the dashboard opens, and the
panel is only a placeholder in the layout, as short as one row. **Pinned bar goes** chooses where:

| Position     | Where it is drawn                                                                       | When scrolled past pins…              |
| ------------ | --------------------------------------------------------------------------------------- | ------------------------------------- |
| **Top**      | Under the bars Grafana keeps fixed, where the panel was across the page.                | once the reader has scrolled past it. |
| **Bottom**   | At the foot of the page, where the panel was across it.                                 | whenever the panel is out of view.    |
| **Floating** | Wherever the reader drags it by the grip at its left; the grip at its right resizes it. | whenever the panel is out of view.    |

A floating bar first opens where a top bar would. Its right grip widens it, and the corner at its bottom
right makes it wider and taller at once. Where it is left is remembered in this browser, per dashboard and panel;
the **save** button on the bar keeps that place in the dashboard instead, so everyone who opens it finds the bar
there once the dashboard is saved. A reader's own drag still wins in their browser until they save it or the
dashboard's place changes. **Space from the edge** adds room under Grafana's own top bars or above the bottom of the
page. **Pinned bar carries** keeps everything or only the buttons and the readout, **Pinned histogram height**
sets how tall its bar is, and **Pinned bar background** is solid or translucent over the panels scrolling under
it.

A floating bar keeps to the **edge or corner** it was left nearest (the top or the bottom; the left, the middle or
the right), with its width a share of the screen's, so a place saved with the dashboard carries to other screens and
to kiosk mode; it never lands off a smaller screen, and on a **phone** it spans the width at its edge, without grips.
The bar **minimizes** to a pill (the window, play and a button to bring it back) and **maximizes** across the page
with a taller histogram, until it is back in the panel. On Grafana 13 it sits above the dashboard's filters. Narrow
bars leave out the mode and speed pickers (under 600 px) and then the zoom buttons (under 400 px).

While the bar is out on the page, the panel becomes a **dock**: the window in large type and where it goes, quick
"last …" windows, the bucket, the scale and the draw style, where the bar sits and a way back into the panel. What a
reader changes there is kept in their browser, and an editor can make it the dashboard's.

## Appearance

| Option                        | What it sets                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Window colour                 | The window's fill, border and handles. Empty: the theme's primary colour.      |
| Shared cursor colour          | The cursor's line. Empty: the theme's warning colour.                          |
| Bars                          | A colour per series, from the standard colour options, or one colour for all.  |
| Bars outside the window       | How visible they stay, in percent.                                             |
| Value scale                   | Linear, square root or log: the last two keep small buckets in sight.          |
| Hatch where there is no data  | The buckets before the first row and after the last, so they do not read as 0. |
| Value guides                  | Rules at the tallest bar and at half of it, with their values.                 |
| Background                    | A colour of the panel's own and its transparency, also on the pinned bar.      |
| Time axis                     | The dates under the histogram.                                                 |
| Window mode and speed pickers | The two pickers at the right of the toolbar.                                   |
| Density                       | Comfortable, or compact for a bar in a short panel.                            |

To colour **each bar by its value**, set the series colour scheme to one by value (thresholds in percent of the
tallest bar, or a by-value gradient): the track can then carry a map's ramp.

## The shared crosshair

With the dashboard's **Graph tooltip** on _Shared crosshair_ or _Shared tooltip_, hovering the histogram moves the
cursor of every Time series and of every map showing its [temporal cursor](/guide/dashboard/temporal-cursor),
and a cursor from a graph is drawn on the histogram as an amber line. Dragging publishes nothing: the pointer is
moving the window, not asking about a moment. Hovering lights the bucket under the pointer, and **Tooltip on hover**
shows its time and values. Both directions have a switch under **Shared cursor**.

## Shade the window on the graphs

The window is two variables, so an annotation can draw it as a region on every Time series, as
[Time window variables](/guide/dashboard/time-window-variables#shade-the-window-on-the-graphs) shows. The
provisioned **Time brush** dashboard of the development bench does exactly that over three random walks.

## What it does not do yet

- It does not move a Trip layer's playhead; that clock still belongs to the map.
- Variables are written from the URL, so a dashboard in kiosk mode without URL sync does not carry them.
