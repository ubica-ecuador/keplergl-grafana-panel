# Peer time sync

**Sync time with other maps** puts every map on the dashboard that has it enabled on the same clock —
in the browser, without moving the dashboard time range and without asking the database anything.

## What it is for

Two or three maps side by side showing different aspects of the same period: vehicles on one,
weather on another, incidents on a third. You want them to animate together.

_Both directions_ time sync can already achieve that — one map moves the dashboard range and the
others follow — but it does it by re-running every query on the dashboard. An animation in that mode
costs a stream of them: 92 queries in ten seconds, measured on two panels. Peer sync passes the time
between the panels directly, so playing an animation on one map moves the others and the database is
never touched.

## Turning it on

Switch it on for **each** map that should participate. It is a mesh, not a leader–follower
relationship: a map with the switch on both sends and receives.

It is off by default because it couples panels, and coupling panels should be a deliberate choice
rather than something that happens because two maps ended up on the same dashboard.

## Both clocks travel

kepler has two independent notions of "now", and each map sends whichever it has:

| Clock           | What it is                  | Which maps have it         |
| --------------- | --------------------------- | -------------------------- |
| **Time filter** | the brushed window          | any map with a time column |
| **Playhead**    | the trip animation position | any map with a Trip layer  |

A map showing flows has a filter and no playhead. A map showing trips in GeoJSON mode has a playhead
and no filter. One showing trips from table columns has both. Each map sends what it has and applies
what it can, so a mixed dashboard still stays broadly in step.

## Echoes

A naive implementation of this bounces forever: A tells B, B applies it and tells A, A applies it
and tells B. Peer sync suppresses that by remembering the last value seen in each direction.

The subtlety worth knowing about, because it explains a behaviour you might otherwise find odd: what
gets remembered after applying an incoming value is **what kepler actually settled on**, not what
arrived. kepler clamps both clocks to its own data's domain, so a map whose data starts later than
its neighbour's will land on a different time than it was sent. Recording the requested value would
make that clamp look like a local change and bounce it straight back.

The practical consequence: a map whose data does not cover the time being broadcast sits at its own
nearest bound rather than going blank, and does not drag its neighbours there.

## What it does not do

- **It does not move the dashboard time range.** Panels that are not maps do not follow.
- **It does not survive a page reload** — it is a browser-side channel between mounted panels, not
  state.
- **It does not cross dashboards or browser tabs.** Two tabs showing the same dashboard have two
  independent meshes.

If you need non-map panels to follow the animation, publish the window to variables instead — see
[Time window variables](./time-window-variables). The two can be combined: peer sync keeps the maps
together, and one of them publishes the window for the tables and stat panels.

## Playing versus dragging

The message a map broadcasts says whether the sender is **playing** or being moved by hand.

A follower cannot work that out for itself — an animation arriving over the channel looks like an
ordinary filter change, and its own "is animating" flag stays false. Anything that needs to treat
playback differently from a drag depends on the sender saying so; the variable publisher is the
case that matters, since without it a followed animation would publish a window per frame.
