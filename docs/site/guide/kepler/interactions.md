# Interactions

kepler's Interactions menu has a section for each of the features below — tooltip, brush,
coordinate display, legend, fading on zoom, the map's name and description, geocoder — and the
panel manages one of them for you.

## Tooltip

Hovering a feature shows selected fields from its row. Which fields is configurable per dataset, and
the defaults are rarely what you want on a wide table.

Two formatting behaviours are worth knowing, both from kepler: a field whose **name contains
`<img>`** and whose value is an HTTP URL renders as an image, and a value starting with `http://`
renders as a clickable link. Both work in a Grafana panel.

Dates in the tooltip are shown in the time zone picked in the tooltip's settings, which is saved
with the map. It is kepler's own setting: it does not follow the dashboard's time zone.

Clicking a feature **pins** the tooltip so it stays put; a blue pin icon unpins it. A right-click
pins it too.

Because the panel passes every column without a role through untouched, everything your query
selected is available here — including columns you added purely for the tooltip.

## Brush

Darkens the map and illuminates only the area under the cursor. It reads well on arc and flow
layers, where a dense map is otherwise impossible to follow.

**Tooltip and brush cannot both be active.** kepler enforces that, not the panel.

## Coordinate display

Shows the latitude and longitude under the pointer, and lets you pin a spot.

::: warning The panel switches this one on by itself
A **Coordinates** cross-filtering mapping is built on kepler's pinned coordinate. So when such a
mapping is configured, the panel enables the coordinate interaction — and re-enables it if you turn
it off, since the mapping would otherwise silently stop publishing.

Turning it off in kepler's menu is therefore not a way to disable the channel. Remove the mapping
under **Cross-filtering** instead.
:::

If you have no Coordinates mapping, the switch behaves exactly as it does in stock kepler.

With the coordinate display on, a right-click on empty map opens a small menu at the pointer with
**Copy coordinates**, which puts `lat, lng` on the clipboard. The same menu offers **Add
Annotation**, whether or not the coordinate display is on, to anyone who can see the map.

## Clicks, and who gets them

The map's click has several possible meanings, and they do not conflict:

| Situation                            | What a click does                           |
| ------------------------------------ | ------------------------------------------- |
| Draw toolbar engaged                 | belongs to the drawing; publishes nothing   |
| A **Click** mapping configured       | publishes the clicked entity's column value |
| A **Coordinates** mapping configured | pins the place and publishes the pair       |
| Neither                              | pins the tooltip, as in stock kepler        |

Clicking empty map clears a Click mapping's variable — but only when the value currently in it was
published by this panel, so a shared link's preset survives a stray click.

A right-click counts as a click for both mappings: on a feature it publishes what a click would, and
on empty map a Coordinates mapping publishes the place, and the menu above opens as well.

See [Cross-filtering](../dashboard/cross-filtering) for both mappings.

## Legend

Chooses which layers appear in the map's legend. A layer left out stays on the map; **Hide hidden
layers in legend** also drops the ones switched off. The switch at the top of this section and the
legend button in the map control are the same switch. Both are saved with the map. See
[Map settings](./map-settings#legend).

## Fade on zoom

Fades layers and annotations in and out as the map zooms. Each controller names the layers it
drives and four zoom levels: where they **Appear**, the **Full start** and **Full end** of full
opacity, and where they **Disappear**. Saved with the map. On a dashboard it is a way to keep a
detailed layer, labels or a dense point cloud out of the way at country zoom without a second panel.

## Map info

A **Name** and a **Description** for the map, shown in a card on its right side; the description
can carry links written as `[label](https://…)`. Both are saved with the map. kepler keeps them
apart from the configuration it exports, so the panel saves them beside it, the way kepler's own
**Export map** does.

## Geocoder

kepler's geocoder needs a Mapbox token and is therefore not usable here, which is consistent with
the rest of the plugin's premise. Use the **Center** cross-filtering mapping to move the map
programmatically instead — a text box or a table data link becomes the search box.

---

**Upstream:** [Interactions](https://docs.kepler.gl/docs/user-guides/g-interactions)

Written against **kepler.gl 3.3.0-alpha.17**. See
[Upstream documentation](../../reference/upstream-docs).
