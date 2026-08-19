# Cross-filtering

The map and the rest of the dashboard talk to each other through **dashboard variables**. Add a
variable, map something to it under **Cross-filtering**, and the map becomes a control for every
other panel.

There are four kinds of mapping, and they behave quite differently.

![A map whose filter drives a dashboard variable](/img/guide-cross-filter.jpg)

| Source          | Direction       | What lands in the variable                        |
| --------------- | --------------- | ------------------------------------------------- |
| **Filter**      | map ↔ variable  | the value of a kepler filter                      |
| **Click**       | map → variable  | the clicked entity's value of a column            |
| **Coordinates** | map → variables | the clicked place, as a lat/lng pair              |
| **Center**      | variables → map | nothing; it _reads_ a pair and moves the viewport |

## Why variables and not Grafana's own cross-filtering

Because a variable is read from the **URL**, which has two consequences that matter.

The map reacts to a variable even when its own query never mentions it — so you can filter the map
from a dropdown, a text box, or a data link on a table row, without the map re-querying. And a
shared link carries the state: send someone a URL and they see the filter you were looking at.

## Filter — the two-way one

The default. Pick a column and a variable; a select, multi-select or text filter set on that column
in kepler's filter panel writes its value to the variable, and changing the variable applies the
matching filter back on the map.

```
Cross-filtering
  Field:    vehicle_type
  Variable: $vehicle_type
```

Now filtering the map to buses filters every panel whose query says
`WHERE type IN ($vehicle_type)`, and picking buses from the variable picker filters the map.

### Numeric ranges

Name a **second** variable and the mapping becomes a _range_ mapping: a numeric range filter on the
column publishes its bounds as a min/max pair, exactly the way the time window does.

```sql
WHERE speed BETWEEN $speed_min AND $speed_max
```

When the filter is removed, **both variables are written blank** rather than left holding their old
values. That is deliberate: with the map at "no filter" and the variables at the old pair, neither
side would ever match the last agreement again and the variables could never drive the map again.

### The "All" value

Grafana's `$__all` and the empty string are both read as "no value", so a multi-value variable set
to _All_ clears the filter rather than filtering for the literal string `$__all`.

## Click — publish the entity

Switch a mapping's source to **Click**. Now clicking a point or a trajectory writes that entity's
value of the column into the variable.

```sql
-- on any consuming panel
WHERE vehicle_id = '$vehicle'
```

One way only, map → variable. Clicking empty map clears the variable — but **only when the running
selection was published from this panel**, so a shared link's preset value survives a stray click on
the sea.

## Coordinates — publish the place

Switch a mapping's source to **Coordinates**. Instead of a column value, the pair of variables named
under **Lat** and **Lng** receives the coordinate that was clicked.

That is what lets another panel run a spatial query around the click, with `$radius` an ordinary
dashboard variable:

```sql
WHERE $lat != ''
  AND ST_DWithin(geom, ST_MakePoint($lng, $lat)::geography, $radius)
```

The computed coverage comes back to the map as one more query, so the panel needs no spatial logic
of its own.

### How pinning works

The panel switches kepler's **coordinate interaction** on by itself for this — and switches it back
on if you turn it off, since the mapping would otherwise silently stop working.

Any click pins the coordinate. Clicking again unpins it on the map, but the **variables keep the
last spot** until the next pin, so the consuming query never loses its centre and never runs with an
empty geometry.

While the draw toolbar is engaged, clicks belong to the drawing and publish nothing.

Values are rounded to **six decimal places**, about 0.1 m — enough that re-pinning the same spot
does not rewrite the variable and re-run the dashboard.

## Center — read a pair back

Switch a mapping's source to **Center** and the same kind of pair works the other way: when the
variables change _from outside the map_, the viewport centres on them, optionally jumping to the
zoom level named in the mapping.

This is what turns a table into a map control. Give the table's query the coordinates as hidden
columns and a per-row data link that writes them:

```
?var-lat=${__data.fields.latitude}&var-lng=${__data.fields.longitude}
```

Clicking a row flies the map to that feature. A pair of text boxes works the same way.

Two behaviours keep it sane: the map's **own** clicks are recognised and never re-centre it, and on
load the saved viewport wins — the pair moves the map only when someone changes it.

## Combining them

The four kinds are exclusive per mapping row, but a panel can have several rows. A common
arrangement is a Click mapping for the entity, a Coordinates mapping for spatial queries, and a
Filter mapping for a category — three rows, three variables, one map driving the whole dashboard.

## What else the map can publish

The bounding box of the current view, and any polygon you draw on it — see
[Publishing the viewport and drawn areas](./publishing).
