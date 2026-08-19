# Tutorial 4 — A cross-filtered dashboard

Turn the map from [Tutorial 1](./first-map) into a control: filter on the map and the rest of the
dashboard follows; click an earthquake and every panel narrows to it. About twenty minutes.

**You need:** the dashboard from Tutorial 1, or any map with a categorical column.

![A map whose filter drives a dashboard variable](/img/guide-cross-filter.jpg)

## The idea

The map and the dashboard talk through **dashboard variables**, and the variable is read from the
**URL**. Two things follow from that, and they are the whole reason this design was chosen:

- The map reacts to a variable **even when its own query never mentions it**, so filtering costs no
  round trip to the database.
- A **shared link carries the state**. Send someone the URL and they see what you were looking at.

## 1. Add a variable

**Dashboard settings → Variables → New variable**.

| Field   | Value        |
| ------- | ------------ |
| Type    | **Text box** |
| Name    | `place`      |
| Default | leave empty  |

A text box, because the map is going to write into it. A query variable would fight you.

## 2. Bind a map filter to it

Back on the map panel, **Panel options → Cross-filtering → + Add mapping**:

| Field    | Value   |
| -------- | ------- |
| Field    | `place` |
| Variable | `place` |

Now open kepler's own **Filters** panel on the left, add a filter on `place`, and type something —
`Alaska`, say. Two things happen: the map filters, and the dashboard variable at the top of the
screen takes the value.

Change the variable by hand instead, and the map's filter follows. This channel is **two-way**.

## 3. Give it something to drive

Add a second panel — **Table** — with the same Infinity query as the map, plus one column filter that
reads the variable. The simplest version needs no query change at all: add a **Filter data by
values** transformation on `place`, matching `$place`.

Now filtering on the map filters the table.

::: tip Why not just use Grafana's panel-to-panel filtering?
Because it does not exist between arbitrary panels, and because a variable is in the URL. This is
more setup for a much more useful result — every panel on the dashboard can read it, and the state
survives a link.
:::

## 4. Click an earthquake, filter everything

A second mapping, this time driven by clicks rather than filters:

| Field    | Value     |
| -------- | --------- |
| Field    | `place`   |
| Variable | `place`   |
| Source   | **Click** |

Click any point on the map. The variable takes that event's `place`.

Click empty ocean and it clears — but only if the value currently in the variable was published by
**this** panel. A value that arrived in a shared link survives a stray click, which is the behaviour
you want when someone sends you a dashboard.

This channel is **one way**: map → variable. Changing the variable does not move the selection.

::: warning A one-pixel target is a one-pixel target
Clicking works by deck.gl's colour picking: what you can click is exactly what is drawn. If clicks
seem not to register, raise the point radius before suspecting the mapping.
:::

## 5. Numeric ranges

Add a third mapping with **two** variables and it becomes a _range_ mapping. Create two more text
box variables, `mag_min` and `mag_max`:

| Field         | Value     |
| ------------- | --------- |
| Field         | `mag`     |
| Variable      | `mag_min` |
| Variable (to) | `mag_max` |

Now a numeric range filter on `mag` in kepler's filter panel publishes both bounds, and a consuming
query can say:

```sql
WHERE mag BETWEEN $mag_min AND $mag_max
```

Remove the filter and **both variables are written blank**, rather than keeping their last values —
otherwise the map would be at "no filter" while the variables held a range, and neither side would
ever agree again.

## 6. Guard the empty value

Every one of these variables is empty before you touch anything, and consuming panels run anyway.
In SQL:

```sql
WHERE ('$place' = '' OR place = '$place')
```

Whether to quote depends on the data source — see
[Variable formats](../reference/variable-formats#consuming-safely).

## 7. Share it

Copy the URL. It contains `var-place=...`. Open it in a private window: the dashboard arrives
filtered, and the map's filter is applied from the variable.

## What you learned

- Filters are two-way; clicks are one-way.
- The URL is the transport, which is why links carry state.
- A second variable turns a mapping into a numeric range.
- Clearing writes blanks deliberately, to keep both sides able to drive.
- Published variables start empty, so consumers need a guard.

## Next

[Tutorial 5 — Click the map, query a radius](./click-to-query), where the click publishes a _place_
rather than a column, and another panel answers a spatial question about it.
