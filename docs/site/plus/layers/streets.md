# Streets

The base map's streets, each one coloured by a value: the traffic a counter reads carried along its street, the air
estimated from the sensors around, or how many vehicles or people pass along each stretch. The streets are
OpenStreetMap's, so no dataset of streets is needed; the layer's rows bring only the values.

![The centre of Madrid on a November evening: every street with one of the City Council's traffic measuring points coloured by its mean load, green on the quiet streets of Chueca and the Barrio de las Letras, red along the Castellana, Gran Vía and Alcalá, each point a dot on its street](/img/plus/streets.jpg)

::: info Since Plus 1.7.0
The Streets layer is new in Plus 1.7.0, not released yet.
:::

## The streets

The layer draws OpenStreetMap's streets as the vector tiles of [OpenFreeMap](https://openfreemap.org/) carry them,
whatever base map the map shows: the tiles in view, from zoom 10, minor streets from zoom 13. **Streets** picks which:

- **Every street** (the default);
- **Major roads only**, for a view of the city's arteries;
- **Streets and paths, no motorways**, for people on foot or on bikes: footways, cycleways and pedestrian streets in,
  motorways out.

**Width** is a tertiary street's width in pixels; wider roads are drawn wider and minor streets narrower. A street that
takes no value is **left to the base map** (the default) or drawn **grey**, in **Colour without a value**.

**With the base map's roads** (on by default): the streets are drawn in the map that draws the roads, right after them,
so the 3D buildings and the names stay in front; with the roads moved to top in Map Layers, in that top map. Off, they
are drawn over the whole base map. Not on the globe, with Relief or on a Mapbox base map.

## Where the value comes from

Add a Streets layer on a dataset of points (latitude and longitude columns) and colour it by a column. **Value from**
says how the rows make each street's value.

### Sensors on the street (along it)

The default, for what flows along the streets: traffic, noise from the traffic, a bus line's delay. Each row is a
sensor (a traffic counter, a noise meter) on its closest street, within **On a street within** (25 m), and its value
runs along that street both ways, as far as **Reach** (300 m): straight on at a crossing, never into a side street.
Between two sensors on one street the value passes from one to the other. **Power** (2) says how fast a sensor counts
less with distance.

### Sensors around (interpolated)

For what spreads through the air: temperature, NO₂, particles. Every street within **Reach** of a sensor takes the
estimate there as the crow flies, as the [Surface](./surface) layer works it out: **Power** and **Neighbours** (Auto,
12 of the closest sensors; 8, 16, 32 or all).

With many rows per sensor (one an hour), **Per sensor** makes them one value in the time window: the **last**, the
**mean**, the **lowest** or the **highest**.

### Points on the street (vehicles, people)

The rows are moving points: vehicle positions, bike or phone traces. Each point stands on its closest street or path,
and each stretch of about 20 m takes a value from the points on it, as **Each stretch** says:

- **Count of points**;
- **Count of ids**, each vehicle or person once however long it stayed, by the **Id column** (a bus at its stop sends
  many points and is one bus);
- the **mean**, **lowest** or **highest** of the colour column (a speed).

**At least, per stretch** leaves a stretch with fewer points (fewer ids, with an id column) without a value, so nobody
is singled out on a quiet street. Counts are coloured by quantiles of the stretches over the colour range.

With an id column, **Join each id along the streets** (on) joins each id's points in time order (**Time column**, or
the rows' order) along the shortest way by the streets, so positions sent every half minute still cover every stretch
driven; a stretch then counts passes, and a vehicle waiting at a stop passes once. Two points further apart than
**Join within (s)** (120 s) in time, or **Join within (m)** (1 km) along the streets, are not joined: a parked car, a
signal lost in a tunnel.

## The flow

**Flow → Animate the flow** (off by default) runs marks along the streets with a value, in each stretch's colour, the
way their traffic goes: one-way streets (OpenStreetMap's `oneway`) one way, the others in two lanes, one each way on
the right of its travel. The streets dim under them.

![Gran Vía and the streets around it on Dark, coloured by vehicles an hour from Madrid's measuring points, dashes running along them, faster on the busier streets](/img/plus/streets-flow.jpg)

- **Marks**: dashes, dots or a soft pulse.
- **Speed**: the same on every street, **faster where the value is higher** (vehicles an hour) or **slower where the
  value is higher** (a load, a jam), between the lowest and highest **Marks per cycle**.

Zoomed out, only the streets at least two mark spacings long on screen run, so a city's side streets do not turn into
a crowd of dots.

## The sensors, the hover and the cards

**Sensors as dots** (on) marks each sensor or point in the colour of its value, **Dot radius** pixels across. The
hover gives the street's value, the closest sensor (along the street, or as the crow flies) and the street's class.

With **Cards → Show: Card on hover**, the stretch under the pointer shows a card with its value over the dashboard's
range, worked out as its colour is: along the street, the sensors that reach it weighed by their distance; around, the
estimate hour by hour; points, per bucket of about a sixtieth of the range. A sensor's dot shows its own readings. Pins
keep a card as the streets in view change. The cards' settings are those of [cards on any layer](./cards).

## Writing it in a saved map

The layer's type is `streets`, on a points dataset (`columns: { lat, lng }`), coloured by `visualChannels.colorField`.
Its settings are in `visConfig`:

| Key                                         | Values (default)                                                  |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `streetsMode`                               | `along` \| `interpolate` \| `points` (`along`)                    |
| `streetsReach`, `streetsSnap`               | metres (300, 25)                                                  |
| `streetsPower`, `streetsNeighbours`         | 2; `auto` \| `8` \| `16` \| `32` \| `all`                         |
| `streetsReduce`                             | `last` \| `mean` \| `min` \| `max`                                |
| `streetsAggregate`                          | `count` \| `distinct` \| `mean` \| `min` \| `max` (`count`)       |
| `streetsIdField`, `streetsTimeField`        | column names (`streetsTimeField`: `auto`)                         |
| `streetsJoin`, `streetsJoinGap`, `streetsJoinDistance` | true; seconds (120); metres (1000)                     |
| `streetsMinCount`                           | 1                                                                 |
| `streetsClasses`                            | `all` \| `major` \| `paths`                                       |
| `streetsWidth`, `streetsEmpty`, `streetsEmptyColor` | 4; `hide` \| `grey`; `[r, g, b]`                          |
| `streetsSensors`, `streetsSensorRadius`     | true, 3                                                           |
| `streetsInBaseMap`                          | true                                                              |
| `streetsFlow`, `streetsFlowStyle`, `streetsFlowSpeed` | false; `dashes` \| `dots` \| `pulse`; `same` \| `faster` \| `slower` |

## Good to know

- The streets come from OpenFreeMap's tiles: a street OpenStreetMap does not map is not drawn, and the network is the
  week's build of the tiles.
- A sensor farther than **On a street within** from every street stands on none; the layer says how many of the rows
  stand on a street in view.
- Up to 5,000 sensors are used in **along** and **interpolate**.
- On the street lights, the day and night styles and the buildings' shadows of the base map, see
  [Night and day](/plus/maps/night-and-day).
