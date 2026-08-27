# Time playback

The bar at the bottom of the map — play, pause, speed, scrubber — is kepler's. It appears when there
is something to animate.

## What creates it

Three different things, and they behave differently:

**A time filter.** Any dataset with a time column gets one, with a histogram and a brush. Playing it
slides the window across the data.

**A Trip layer.** A trajectory query produces one, with a playhead that moves along the paths. See
[Trajectories](../data/trajectories). Velocity fields are Trip layers underneath, so they animate
the same way — see [Wind and other velocity fields](../data/velocity-fields).

**An imagery calendar.** A query that returns one row per date alongside a raster URL — or a WMS
layer whose service publishes its own dates — puts those dates on the widget, and playing it walks
the pictures. Nothing is re-queried as it does: the catalogue is already in the browser, and a WMS
costs one image per date. See [Imagery over time](../data/imagery-over-time).

A map can have more than one. They are separate clocks, which is why
[peer time sync](../dashboard/peer-time-sync) carries them as separate fields.

## Trail length

For Trip layers, **Trail Length** in the layer settings decides how much of the path stays visible
behind the moving head. It changes the character of the map completely:

- **Short** — drifting particles. Good for dense fields and for wind.
- **Long** — the route drawing itself. Good for a handful of journeys.

kepler exposes this control in its layer panel but does not document it; it is deck.gl's TripsLayer
`trailLength`. See [Under the hood](../../reference/under-the-hood).

## Playback and the dashboard

How the animation relates to the rest of the dashboard is the **Time range sync** setting, and the
choice matters most here — playback is where the cost of the wrong mode shows up:

| Mode                    | Playing an animation                                              |
| ----------------------- | ----------------------------------------------------------------- |
| Dashboard drives map    | animation is local; nothing else moves                            |
| Both directions         | **every query on the dashboard re-runs, repeatedly**              |
| Slider writes variables | only the panels reading the variables re-run, and only if you ask |
| Off                     | animation is local                                                |

_Both directions_ is the one to avoid for animation: 92 queries in ten seconds was the measurement
on a two-panel dashboard.

In _Slider writes variables_ mode, **Update variables while playing** decides whether the window is
published during playback or only when it stops. Off by default, because each write costs the
animation frames. See [Time window variables](../dashboard/time-window-variables).

To animate several maps together without any of this, use
[peer time sync](../dashboard/peer-time-sync) — the clock passes between panels in the browser and
the database is never asked anything.

## Speed

kepler's speed control multiplies playback rate. Note that it interacts with the two costly modes
above: at 4× in _Both directions_, you are asking for four times as many query rounds.

## Data outside the window

Kepler's animation shows the window; it does not remove the rest of the data. Widening the brush
brings it back instantly — unless the dashboard time range moved and re-ran the query, in which case
the rows are genuinely gone. That is the ratchet described in
[Time range sync](../dashboard/time-range-sync).

---

**Upstream:** [Time playback](https://docs.kepler.gl/docs/user-guides/h-playback)

Written against **kepler.gl 3.3.0-alpha.7**. See
[Upstream documentation](../../reference/upstream-docs).
