# 3D Callout

A card on a stem above each place, the way a 3D map labels summits, masts or a building's sensors: its name, its
value and, with a time column, its series. A 3D Callout is a [Sparkline](./sparkline) whose cards stand above their
places in 3D, at a height you give them, instead of beside them on the ground.

![Eraring Power Station's four units with a callout on a stem above each: the unit's output in MW and the day's series. Unit 3's callout names the Grafana alert firing on it, Unit trip, in red, and the alert's red disc sits on the unit](/img/plus/callout.jpg)

::: info Since Plus 1.7.0
The 3D Callout layer is new in Plus 1.7.0, not released yet.
:::

## See it in the layer tour

The **Digital twin** map of the [layer tour](/plus/start/templates#digital-twin), installed with the app, shows two CO₂ sensors as 3D Callouts, placed in metres on their floors, beside the storeys' own cards,
on the app's sample building, on synthetic data. Open it and press ▶ on its time filter to replay the day.

## What the query needs

The same rows as a [Sparkline](./sparkline#what-the-query-needs): one row per reading, with the place's latitude and
longitude, a time for the series, the reading, a name and an optional id. Add an altitude column, in metres above
the ground, to lift each place:

```sql
SELECT r.ts       AS time,
       u.name,                -- Unit 1
       u.duid,                -- ER01, the id before the name
       r.mw,                  -- the reading: the layer's colour field
       u.latitude, u.longitude,
       u.roof_m   AS altitude -- where the callout's stem starts
FROM readings r JOIN units u USING (duid)
WHERE $__timeFilter(r.ts);
```

Without a time column, a callout shows a value alone, as a label: each place's last row with a value, in the
query's order.

A place known by its part of a 3D model, or by metres from the model's origin, needs no coordinates: see
[Data in a model's frame](/plus/data/model-frame).

## Adding the layer

The panel never creates a 3D Callout layer by itself. In kepler's layer panel, add a layer, pick **3D Callout** as its
type, and set its latitude, longitude and altitude columns. Colour it by the reading, as a Sparkline, then tilt the
map with the 3D control.

## The height

Each callout's stem starts at its place's height: its **altitude** column plus **Lift (m)**, standing on what
**Height on** says:

| Height on                     | The altitude and the lift are measured from                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| **Altitude column**           | Nothing: the altitude column as it is, from the ground of the map.                       |
| **Ground (3D tiles)**         | The ground under the place, measured off the [3D tiles](/plus/maps/3d-tiles) on the map. |
| **Roof or canopy (3D tiles)** | The top of what stands at the place in the 3D tiles: a roof, a tree's canopy.            |

Without 3D tiles on the map, the ground is at 0. A photogrammetry mesh, such as Google's, has no ground under a roof:
on **Ground**, a place inside a building stands on its roof.

**Lift** fits places with no altitude of their own: a floor's height above a building's base, a mast's top, a
summit's marker.

## The stem and the card

The stem rises straight up from the place, and the card is centred at its top. **Stem (px)** is the shortest stem;
when two cards would overlap, one climbs to a higher level to clear the other. A card above the horizon of a low view
keeps its stem.

The card is a Sparkline's: the header with the id and the name, the value in its band's colour, and the series with
its cursor. Every other setting works as on the [Sparkline](./sparkline): **Cards** on **Auto** or **On hover** with
pins, **Card size**, **Scale**, **Chart over**, **Unit**, the alerts for no data, and Grafana's shared crosshair.

Callouts keep off the cards of the map's other card layers: the layer higher in kepler's list places its cards
first.

## Grafana alerts on a callout

With the panel's [Active alerts](/plus/data/active-alerts) on and their **Entity label** set to the label your rules
name the place by, a firing alert on a place marks its callout: always shown, drawn over the others, with a blinking
button and the rule's name in red in its header. With **Cards** at **On hover**, it shows without a hover while the
alert fires.

**Alert label** says which label of the alerts names the place. On **auto** it is the label named like the layer's
id column (`duid` above); type another label's name, or clear it to show no alerts.

## Options

In the layer's settings, kepler's **Color** group, a **Callout** group, then the Sparkline's groups.

| Option          | What it does                                                                          | Default         |
| --------------- | ------------------------------------------------------------------------------------- | --------------- |
| **Stem (px)**   | The shortest stem, 8 to 240 pixels.                                                   | 36              |
| **Height on**   | **Altitude column**, **Ground (3D tiles)** or **Roof or canopy (3D tiles)**.          | Altitude column |
| **Lift (m)**    | Metres added to every place's altitude.                                               | 0               |
| **Alert label** | The Grafana alert label naming the places; **auto**, the id column; empty, no alerts. | auto            |

The Sparkline's options follow; see [Sparkline options](./sparkline#options).

## When it does not draw

- **No layer at all.** The panel does not create a 3D Callout layer from the data; add one.
- **Cards on the ground.** The map is flat: tilt it with the 3D control. Or the altitude column is not set and
  **Lift** is 0.
- **Cards high in the sky.** The altitude column is above sea level, not above the ground. Clear it, or set
  **Height on** to **Ground (3D tiles)** with **Lift** for the height above it.
- **Cards with no value and no line.** The layer has no colour field, as on a Sparkline.
- **No alert on a callout.** **Active alerts** are off, their **Entity label** is not set, or **Alert label** is
  not the label the rule names the place by.

## Use it for

- Digital twins over [3D tiles](/plus/maps/3d-tiles) or a [4D Model](./model-4d): a sensor per floor or per unit
  with its live value and its day.
- Summits, huts and passes on terrain.
- Masts, antennas and wind turbines at their height.
