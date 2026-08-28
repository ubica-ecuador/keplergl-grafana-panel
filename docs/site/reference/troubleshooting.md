# Troubleshooting

Ordered roughly by how often each one bites.

## The panel does not load at all

**Symptom:** a module error where the visualisation should be, or the panel type shows as unknown.

Two causes, in order of likelihood.

**The Grafana patch level.** The plugin requires
`>=12.0.10 <12.1 || >=12.1.7 <12.2 || >=12.2.5`. Grafana only added `react/jsx-runtime` to its
module import map in those patches; below them the plugin cannot load. A 12.0.**5** install will
fail even though it is "Grafana 12".

**The plugin is unsigned.** Pre-1.0 it needs to be allowed explicitly:

```ini
[plugins]
allow_loading_unsigned_plugins = ubica-keplergl-panel
```

Then restart Grafana. See [Install](../guide/install).

## The map is there but the base map is blank

**Cause:** Content Security Policy. MapLibre fetches styles, sprites, glyphs and tiles over XHR, so
they all fall under `connect-src` — which `content_security_policy = true` closes.

Add the hosts for the base maps you actually use:

```ini
content_security_policy_template = """… connect-src 'self' grafana.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://services.arcgisonline.com https://tiles.mapterhorn.com …;"""
```

Or set **Base map** to a self-hosted `style.json`, or to _No Basemap_, and skip it entirely. See
[Base maps and relief](../guide/map/basemaps-and-relief).

Note that the _thumbnails_ in the style picker will still load when the tiles do not — they are
`<img>` elements under `img-src`. A picker full of working thumbnails over a blank map is the
signature of this problem.

## Maps go black when several are open

**Symptom:** `Too many active WebGL contexts. Oldest context will be lost.` in the console, and the
maps you scrolled past are black.

**Cause:** each map holds **two** WebGL contexts — MapLibre's and deck.gl's — and browsers cap the
total at around sixteen. That is roughly eight maps, fewer with split views.

**Fix:** put maps in **collapsed** Grafana rows. Grafana does not render panels inside a collapsed
row, and collapsing one releases its contexts. Or use fewer, larger maps with more layers each.

## The query returns rows but nothing is drawn

Work down this list:

1. **Radius.** kepler's default point radius is small. On a country-sized view a few thousand points
   can be genuinely invisible. Raise it in the layer panel first.
2. **Detection.** Open **Field mapping** and look at the placeholders — they show what was detected.
   No latitude means no point layer. See [Field roles](./field-roles).
3. **A filter.** kepler filters are part of a saved configuration, so a dashboard can open with one
   already applied. Check the filter panel.
4. **The layer is hidden.** Check the eye icon in the layer list.
5. **Max Top Flows.** For flow layers, the default caps display at 5,000 flows; the smallest are
   simply not drawn.

## Everything is in the Gulf of Guinea

Coordinates at (0, 0), or a tight cluster off West Africa. Almost always non-numeric coordinates —
strings that failed to parse to zero.

With the **Infinity** data source this is the default behaviour: its CSV parser types everything as
string. Set the lat/lng columns to **Number** in the column configuration. Geometry columns stay
**String**.

## The data is in the wrong place entirely

**Cause:** a projected coordinate reference system. The panel renders EPSG:4326 degrees and **does
not reproject**; a UTM easting of 720,000 is read as 720,000 degrees.

**Fix:** project in the query, `ST_Transform(geom, 4326)`. For WFS, ask the server for it:
`&srsName=EPSG:4326`. GeoServer otherwise returns the layer's native CRS. See
[Infinity](../guide/sources/infinity).

## A variable arrives double-quoted

**Symptom:** a SQL error showing `''some value''`.

**Cause:** the data source interpolates with Grafana's SQL-string format, which adds the quotes
itself. The DuckDB data source does this; PostgreSQL does not.

**Fix:** write `$var` rather than `'$var'` on those sources, and cast defensively:

```sql
WHERE ts >= coalesce(try_cast($mapFrom AS TIMESTAMPTZ), '-infinity')
```

## The map filtered itself and will not zoom out

**Symptom:** zooming out shows no more data than before, and the only fix is a page reload.

**Cause:** the panel's own query consumes something the panel publishes — `$west`/`$east`, the drawn
area, or the dashboard time range in _Both directions_ mode. Narrowing removes rows from the browser,
and widening cannot bring them back because the query result no longer holds them.

**Fix:** those channels are for the **other** panels. Use _Slider writes variables_ for time, and
keep the viewport and area variables out of this panel's query. See
[Publishing](../guide/dashboard/publishing).

## Layer styling disappears on reload

Expected. Styling lives in kepler's store: it survives a query refresh but not a page load, until
you capture it with **Map configuration → Save current map**, then save the dashboard. See
[Map configuration](../guide/map/map-configuration).

## A panel option seems to do nothing

**Cause:** a saved map configuration. It names its own base map and carries its own styling, so it
overrides **Base map** and makes **Follow dashboard theme** look broken.

**Fix:** re-save the map to take a new snapshot, or clear the stored configuration.

## The coordinate interaction turns itself back on

Expected. A **Coordinates** cross-filtering mapping is built on kepler's pinned coordinate, so the
panel keeps that interaction enabled. To stop it, remove the mapping rather than the interaction.
See [Interactions](../guide/kepler/interactions).

## The camera jitters on a tilted relief map

A known MapLibre 4 issue, and kepler pins MapLibre 4 —
[keplergl/kepler.gl#3394](https://github.com/keplergl/kepler.gl/issues/3394). Nothing to configure;
reduce the tilt or use a flat base map.

## Data floats above the terrain

Expected, and not fixable from here. The relief belongs to the base map; deck.gl draws your data at
its own altitude and nothing drapes over the ground. See [Under the hood](./under-the-hood).

## A trajectory layer vanishes as I zoom in

**Cause:** an altitude column mapped by accident, holding metres above sea level. deck.gl reads a
path's third coordinate as height **above the ground**, so a trace at 2,650 m is drawn 2.65 km up
and disappears once the camera descends below it, at roughly zoom 15.

**Fix:** set **Field mapping → Altitude** to **None**. This is why altitude has no autodetected
column names.

## DuckDB will not start

The DuckDB data source is linked against glibc and does **not** run on Alpine. Use a Debian or
Ubuntu-based Grafana image. It is also outside the Grafana catalog, so it installs from a release
zip and is unsigned.

## Wind streamlines look like a solid block, or like nothing

Both are the same control, and it is on the layer rather than in the panel options: open the **Flow
field** layer and change **Streamlines → Lines per screen**, 9,000 by default. There is no value
that suits every extent — lower it when the field looks matted, raise it when it looks sparse.

A field that draws *nothing at all* is usually not the density. Press play: at the start of the
animation window every trail has zero length, so a paused field is a blank map. If it is playing and
still blank, the grid was probably rejected — see
[Velocity fields](../guide/data/velocity-fields).

## Still stuck

Check the browser console: this panel logs the useful failures there rather than swallowing them.
Then check the query inspector to see what actually reached the panel — a surprising number of "the
map is broken" reports are "the query returned no rows".
