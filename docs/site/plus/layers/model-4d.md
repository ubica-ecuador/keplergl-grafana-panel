# 4D Model

A 3D model whose parts are built in time. Each row of the query names a part of the model and gives its start and
finish. At the map's instant, a part is still to build (a faint outline), under construction (one colour) or built
(the model's own colours, or a colour from a column). For construction schedules (BIM 4D), phased works, and digital
twins of a site whose parts have a state.

[![An apartment block in Nijmegen half built: the ground floor in amber under construction, the brickwork and windows below it built, the floors to come as a faint outline](/img/plus/model-4d.jpg)](https://pacha.ubica.dev/d/schependomlaan-4d)

[Open this dashboard live →](https://pacha.ubica.dev/d/schependomlaan-4d)

::: info Since Plus 1.6.0
The 4D Model layer is new in Plus 1.6.0.
:::

## See it at work

Two dashboards on the [live demos](https://pacha.ubica.dev/dashboards/f/plus/?orgId=1) use it, one for each way of
reading the model:

- **[Schependomlaan, built day by day](https://pacha.ubica.dev/d/schependomlaan-4d)**: an apartment block built in
  Nijmegen in 2015, from the public Dataset Schependomlaan (TU Eindhoven and partners, CC BY 4.0). A
  [Time Brush](/plus/time-brush) walks the build: the model shows every element as it stood at the brush's end, and
  the schedule, the S-curve and the cards follow the same window.
- **[Eraring, live](https://pacha.ubica.dev/d/aemo-eraring-live)**: a power station in New South Wales with its four
  units coloured by what each one is doing now, from the market operator's five-minute readings. The rows have no
  schedule, so every part is built and the layer's colour carries the state.

## What the model needs

A glTF model, `.glb` or `.gltf`, whose **nodes are named by the parts' ids**. Every mesh under a node of that name is
the part, a nameless node taking its parent's name, so a model exported with one node per element gives one part per
element, whatever the exporter put under it.

From IFC, the BIM exchange format, each element has a GlobalId that the schedule refers to. IfcOpenShell's
`IfcConvert` writes a glTF with each element's node named by its GlobalId:

```sh
IfcConvert --use-element-guids model.ifc model.glb
```

The model's origin is its (0, 0, 0): glTF's Y axis is up and -Z is north, so a model exported in a site's local
coordinates stands as it was drawn once its origin is placed and turned (see [Placing the model](#placing-the-model)).

The browser fetches the model itself, so its address must be one the viewer's browser can reach: served by Grafana's
own host, or by another that allows it with CORS. A
[Content Security Policy](/plus/admin/csp) that lists the hosts the browser may connect to must list that one.
Each model is loaded once per page, whatever the number of maps and refreshes.

## What the query needs

One row per part:

| Column              | What it is for                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| an id (text)        | The part's node name in the model, such as an IFC GlobalId.                                            |
| a start (time)      | When the part's work starts.                                                                           |
| a finish (time)     | When it ends. Optional: without one, a part is built the instant it starts.                            |
| latitude, longitude | The model's origin, the same on every row. The first row shown places the model.                       |
| anything else       | Shown in kepler's tooltip on hover, and usable as the layer's colour: a trade, a contractor, a status. |

A construction schedule usually gives a task per row and the elements each task builds. Join them so each element
has its own row:

```sql
SELECT e.guid,
       t.name        AS task,
       t.start_date  AS start,
       t.finish_date AS finish,
       e.kind,
       site.latitude,
       site.longitude
FROM elements e
JOIN tasks t ON t.id = e.task_id
CROSS JOIN site;          -- one row: the model's origin
```

Several rows for one part (one per task, say) make one: it starts with the earliest and finishes with the latest, and
keeps the first row's colour and tooltip. Rows naming a part the model does not have are left out.

On **Auto**, the layer finds its columns by name, without regard to case:

| Setting     | Columns found on Auto, in order                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| **Part ID** | `guid`, `globalid`, `global_id`, `ifc_guid`, `ifcguid`, `element_id`, `element`, `part_id`, `part`, `node`, `id`      |
| **Start**   | `start`, `start_date`, `start_time`, `planned_start`, `task_start`, `begin`, `begins`, `from`, `time`                 |
| **Finish**  | `finish`, `finish_date`, `finish_time`, `end`, `end_date`, `end_time`, `planned_finish`, `task_finish`, `until`, `to` |

The panel renames the time column it detects to `time`, which **Start** finds on Auto.

## Adding the layer

The panel never creates a 4D Model layer by itself. In kepler's layer panel, add a layer, pick **4D Model** as its
type, set its latitude and longitude columns, and paste the model's address in **Model URL**. Then tilt the map with
the 3D control to see the model standing.

## The instant

Every part is drawn as it stands at one instant:

- **A time filter on the Start column**: the end of its window. This is the filter kepler's time playback moves, and
  the one a [Time Brush](/plus/time-brush) moves through the map's time sync. The filter sets the instant only: it
  hides no part, since a part built long before the window is still standing.
- **Otherwise**: the end of the dashboard's time range. The time picker then walks the build.

At that instant, each part is in one of three states:

| State                  | When                              | Drawn                                                              |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| **Still to build**     | Before its start                  | A faint outline of what is coming, or nothing (**Still to build**) |
| **Under construction** | From its start through its finish | The **Under construction** colour, amber by default                |
| **Built**              | After its finish                  | The model's own colours, or the layer's colour (**Built parts**)   |

A row without a start is always built. A part no row names (the site, the surroundings, anything the schedule leaves
out) is drawn as built, or left out with **Parts with no row** off.

## Built parts in a colour

With **Built parts** at **Layer colour**, built parts take the layer's colour instead of the model's. Colour the layer
by a column, and the model shows that column: the trade of each element, the contractor, whether it was finished on
time. A text column takes a custom ordinal range, each value with its own colour (see
[Colour palettes and scales](/guide/kepler/colour-palettes-and-scales)).

The [Schependomlaan dashboard](https://pacha.ubica.dev/d/schependomlaan-4d) colours by trade or, with its **Colour** variable, by whether the as-built record has the
element late. The query picks the column the layer colours by:

```sql
SELECT guid, task, time, finish_date, latitude, longitude,
       CASE WHEN '${colour:raw}' = 'as_built' THEN as_built ELSE kind END AS colour_by
FROM parts;
```

## A live state, with no schedule

Rows with no start are always built, so the layer also draws a model whose parts change state rather than being built:
a plant's units, a building's floors, a substation's bays. Give each row its part's id and its current state, colour
the layer by the state, and set **Built parts** to **Layer colour**. Every refresh repaints the parts.

[![Eraring Power Station with its four units coloured by what each is doing now, blue at low load and grey offline, a sparkline card over each unit with its output over the day](/img/plus/model-4d-live.jpg)](https://pacha.ubica.dev/d/aemo-eraring-live)

[Open this dashboard live →](https://pacha.ubica.dev/d/aemo-eraring-live)

The [Eraring dashboard](https://pacha.ubica.dev/d/aemo-eraring-live) does this with one row per unit:

```sql
SELECT u.duid,                                 -- the unit's node in model.glb
       CASE WHEN l.mw IS NULL THEN 'No reading'
            WHEN l.mw < 10    THEN 'Offline'
            WHEN l.mw < 360   THEN 'Low load'
            WHEN l.mw < 648   THEN 'Running'
            ELSE 'Full load' END AS state,
       strftime(l.ts, '%-d %b %H:%M') AS reading,  -- text, not a time
       u.origin_latitude AS latitude, u.origin_longitude AS longitude
FROM units u LEFT JOIN latest l USING (duid);
```

Keep the time of the reading as text. A time column would be detected, named `time` and taken as the parts' start, and
a reading of a few minutes ago would put the parts under construction.

A [Sparkline](./sparkline) layer on the same map, lifted by an altitude column, puts each unit's series in a card over
its part.

## Placing the model

The model's origin stands at the rows' latitude and longitude. **Heading** turns it clockwise from north about that
origin, and **Altitude** lifts it, in metres. Turn the heading until the model sits on the base map's footprint.

## Options

In the layer's settings, under **4D Model**, **Placement** and **Schedule**, and in kepler's **Color** group.

| Option                 | What it does                                                                               | Default         |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------- |
| **Model URL (.glb)**   | The model's address. Its nodes are named by the **Part ID** column.                        | empty           |
| **Part ID**            | The column naming each row's part.                                                         | Auto            |
| **Start**              | When each part's work starts. A time filter on it sets the instant.                        | Auto            |
| **Finish**             | When its work ends. Without one, a part is built the instant it starts.                    | Auto            |
| **Heading (°)**        | Degrees clockwise from north the model is turned by, about its origin.                     | 0               |
| **Altitude (m)**       | Metres the model's origin stands above the ground.                                         | 0               |
| **Still to build**     | Parts not started yet: **Outline**, faint and see-through, or **Hidden** until they start. | Outline         |
| **Parts with no row**  | On, parts no row names are always drawn as built; off, they are left out.                  | on              |
| **Built parts**        | **Model's colours**, or **Layer colour**: one colour, or by a column such as a status.     | Model's colours |
| **Under construction** | The colour every part takes while it is under construction.                                | amber           |

**Opacity**, in the **Color** group, applies to the whole model.

## Hover and tooltip

Hovering a part shows its row in kepler's tooltip: the task, the dates, the trade, any column the query returns. Pick
the fields under **Tooltip** in kepler's interactions panel; the layer's **Interaction** group turns hovering off.
Parts still to build are not picked, so the pointer reaches the built ones behind their outline.

## When it does not draw

- **No layer at all.** The panel does not create a 4D Model layer from the data; add one.
- **Nothing on the map.** **Model URL** is empty, the browser cannot fetch the model (look for a CORS or Content
  Security Policy error in the browser's console), or no row has latitude and longitude.
- **The whole model in its own colours, nothing in time.** No column was found for **Part ID**, or its values are
  not the model's node names. Check the ids against the node names in a glTF viewer.
- **Everything built.** No **Start** column was found, or the instant is past the last finish: look at the
  dashboard's time range.
- **Everything still to build.** The instant is before the first start: the dashboard's range ends before the
  schedule begins.
- **Parts under construction that should be built.** A time column was taken as **Start** on Auto. Set **Start** to
  the right column, or return the time as text.
- **The model is off its footprint.** Set **Heading** and check that the rows' coordinates are the model's origin,
  not the building's centre.

Plus layers share more behaviour, such as clicks and drawn polygons: see [Plus layers](/plus/layers/).

## Use it for

- Construction schedules: what should stand on a given day, what is late, which trade is on site.
- Phased works: a road, a rail line or a pipeline built section by section.
- Digital twins: the units of a plant, the floors of a building or the bays of a substation coloured by their live
  state.
- Maintenance campaigns: the parts of an asset coloured by their last inspection.
