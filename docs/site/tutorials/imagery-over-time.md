# Tutorial 7 — Imagery over time

A rainfall satellite product over Ecuador, with the map's clock walking its days — and a click that
asks the service how much rain fell where you pointed. About fifteen minutes.

**You need:** nothing but the panel. No tile server, no database, no ETL, and no data of your own.
This one uses Grafana's built-in **TestData DB** for two strings, and a public WMS does the rest.

## 1. Create the panel

New dashboard → **Add visualisation** → **TestData DB** → visualisation **Kepler Geospatial Maps**.

## 2. Give it a service and a layer

In the query editor set **Scenario** to **CSV Content**, and paste two columns and one row:

```csv
wms_url,wms_layer
https://services.geoglows.org/geoserver/satellite_based_precipitation/wms,persiann_pdir_24h
```

That is the whole configuration. Set the dashboard time range to something recent — **Last 7 days**
is a good start — and the imagery appears.

::: warning If the map stays empty
On a Grafana with `content_security_policy = true`, add `https://services.geoglows.org` to
`connect-src` in `content_security_policy_template` — **not** `img-src`. A WMS image is fetched and
parsed as data, so the directive that looks right is the wrong one, and getting it wrong produces a
blank map with no message about images. See [Install](../guide/install#hardened-grafana).
:::

## 3. What happened

You gave two strings and got a map. Worth separating out what each one did:

- `wms_url` is the **bare endpoint** — no `?`, no parameters. Every request the panel makes is built
  by appending to it.
- `wms_layer` names one of the many layers that service publishes. A URL on its own is not a picture,
  which is why the two roles are all-or-nothing.

Nothing is rendering this on your behalf. A COG would have needed a [tile server](../guide/data/rasters)
in the middle, because a GeoTIFF is not tiles — a WMS **is** the server, and that is why this
tutorial needs no infrastructure. See [WMS services](../guide/data/wms).

## 4. Drag the time widget

The bar at the bottom of the map has one mark per day the service holds. Drag it, and the rain
changes day.

**You did not give it any dates.** The panel read them out of the service's own capabilities
document — a time-aware layer publishes a `<Dimension name="time">` listing every pass it has — and
turned them into the map's timeline. That is the version of this arrangement that keeps working by
itself: tomorrow the server gains a pass, and the widget has it without anyone editing a dashboard.

Open kepler's data table and you will find a dataset you did not write — `grafana-A-wms-times`, one
row per date. It has to exist, because kepler's time filter is always a filter **on a column**: no
rows, no widget.

Note that the widget spans what the **service** has, not the dashboard's range. On the day this was
written that was 603 days, from January 2025 to today, out of a dashboard set to the last seven.

Each drag costs **one image**. No query is re-run, no dataset is rebuilt, and a drag that stays
between two dates asks for nothing at all. See [Imagery over time](../guide/data/imagery-over-time).

## 5. Press play

The same widget animates. A week of rainfall crossing the country in ten seconds is the point of the
whole exercise, and it is a good moment to notice that the layer you are watching is the same layer
throughout: rename it, restyle its opacity, and the styling survives every date change.

## 6. Click the map

Turn on kepler's tooltip interaction and click somewhere with rain on it. The value appears in the
popover.

That answer did not come from a table — a WMS carries no rows. Clicking asks the service what is
under that pixel, **on the date currently on screen**, so the number is about the picture you are
looking at rather than the service's default slice.

Read the answer literally. A sentinel like `-99` means _no data here_, not a failure.

## 7. Send that number to the dashboard

In the panel options, under **Cross-filtering**, add a **click mapping** on the field `wms_value` and
point it at a dashboard variable — say `rain`. Now every click writes the value under your pointer
into `$rain`, and any panel on the dashboard can read it.

`wms_value` is the first value the service returned, under a name that is the same for every service.
The attributes also arrive under their own names, both as the service spells them (`GRAY_INDEX`) and
as kepler displays them (`GRAY INDEX`), which matters for a vector WMS that returns several.

See [Cross-filtering](../guide/dashboard/cross-filtering).

## 8. The other way to get a calendar

This dashboard let the **service** supply the dates. The other option is to supply them yourself:
return one row per date, alongside the same two columns, and those rows are the timeline.

```csv
time,wms_url,wms_layer
2026-08-20T00:00:00Z,https://services.geoglows.org/geoserver/satellite_based_precipitation/wms,persiann_pdir_24h
2026-08-21T00:00:00Z,https://services.geoglows.org/geoserver/satellite_based_precipitation/wms,persiann_pdir_24h
2026-08-22T00:00:00Z,https://services.geoglows.org/geoserver/satellite_based_precipitation/wms,persiann_pdir_24h
```

The query wins when both exist. Use it when you want a subset of what the service has, or a calendar
assembled from somewhere else entirely — and prefer the service's own when you want the dashboard to
stay correct without maintenance.

## What you learned

- Two string columns, `wms_url` and `wms_layer`, are enough to put live imagery on the map.
- A WMS needs no tile server, which is what makes it work on a Grafana with nothing behind it.
- A time-aware service publishes its own calendar, and the panel walks it — one image per drag.
- Clicking asks the service, on the date on screen, and the answer can drive dashboard variables.
- A strict CSP wants the host in `connect-src`, never `img-src`.

## Where to go from here

- [Imagery over time](../guide/data/imagery-over-time) — the same clock over COGs and PMTiles
  archives, and why not to couple it through dashboard variables.
- [Satellite imagery and other rasters](../guide/data/rasters) — the other path: your own imagery,
  through a tile server you control, or an archive with no server at all.
- [Measuring imagery](../guide/sources/measuring-imagery) — getting numbers out of the scene rather
  than looking at it, including reading this same coverage as data over WCS.
