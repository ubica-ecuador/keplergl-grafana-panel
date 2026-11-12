# Indoor tab and settings

Everything Floors does is set in the **Indoor** tab of kepler's side panel, the last tab, and in the windows it opens.
The essentials are also in the panel's options, in the **Floors** group (see [Turn it on](./#turn-it-on)). All of it
is saved in the panel's `floors` options, with the dashboard.

![kepler's side panel on its Indoor tab, beside the Audimax map: the Floors switch on, the building with its three floors a line each (each added here, with its plan and 5, 6 or 7 rooms, the ground floor opening the map), Add a building, the spread between floors at 7 m and the other floors seen through](/img/plus/floors-indoor-tab.jpg)

::: info Since Plus 1.7.0
The Indoor tab is new in Plus 1.7.0, not released yet.
:::

## The tab

From the top:

- **Floors**: the switch, the same as **Floor picker** in the panel's options.
- **Buildings and floors**: a tree, each building with its floors, top floor first. A line says what a floor holds
  (_42 rows_, or _added here_ for a floor added by hand; _plan ✓_ when its plan is aligned; its rooms; _opens here_
  for the floor the map opens on). A name opens its window; ▸ unfolds what it holds: its outline drawn on the map and
  its rooms, each opening where it is edited. **+ floor** adds a floor to a building, **Add a building** a building.
  **Data…** opens the settings on where the floors come from.
- With no floor yet, a start: **Add a floor**, **Add a building**, or **Choose the floor column**.
- **Spread between floors** and **Other floors**, what the map opens with (the picker's controls write the same
  settings).
- **Layers**: the layers of the plans and rooms (Floor plans, Floors drawn, Rooms, Walls, Room names, Dials), each with
  its eye; one not on the map yet is added. See [What the rooms draw](./plans#what-the-rooms-draw).
- **All settings…**: the settings window.

## A floor's window

| Tab       | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Floor** | Its level and building (**Change its level or building…** for a floor added here); its outline (**Draw it on the map**); **Name**; **Height (m)**, from this floor to the next, in place of the spread; **The map opens on it** (with several buildings: **Its building shows it while another is looked at**); **Listed on the floor picker**, off for a roof or a plant floor whose rows still draw; **Shown with it**, the floors seen with it. |
| **Plan**  | The plan's **Address** or **Upload a picture**, **Remove**, and **Align by points**. See [Floor plans and rooms](./plans).                                                                                                                                                                                                                                                                                                                         |
| **Rooms** | **On the plan**: the rooms editor. **On the map**: **Draw rooms on the map**. See [Rooms](./plans#rooms).                                                                                                                                                                                                                                                                                                                                          |

## A building's window

**Name**, **Base (m)** and **Default floor**. See [Each building its own](./buildings#each-building-its-own).

## The settings window

**All settings…** opens it, by section.

| Section      | Setting                                                                           | What it does                                                                                  | Saved as                        |
| ------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------- |
| **Data**     | **Floor column**                                                                  | Each row's floor. Auto finds `level`, `ordinal`, `floor`, `storey`…                           | `field`                         |
|              | **Floor name column**                                                             | Each floor's name. Auto finds `floor_name`, `level_name`…                                     | `nameField`                     |
|              | **Building column**                                                               | Each row's building. Auto finds `building`, `building_id`…                                    | `buildingField`                 |
|              | **Site column**                                                                   | Each building's site. Auto finds `site`, `campus`, `city`…                                    | `siteField`                     |
|              | **plan_x, plan_y count**                                                          | Pixels, a share of the picture, or metres from its top left.                                  | `planUnits`                     |
| **Picker**   | **Opens on**                                                                      | The floor the map opens on, or every floor.                                                   | `defaultFloor`                  |
|              | **Floor variable**                                                                | The variable the picker writes and follows.                                                   | `variable`                      |
|              | **Building variable**                                                             | With several buildings: the variable the building looked at is written to and read from.      | `buildingVariable`              |
|              | **Other buildings**                                                               | With several buildings: the others on their default floor, every floor, or hidden.            | `otherBuildings`                |
|              | **Selection variable**, **Matched by**                                            | A room, a sensor or a place to go to, and the column it is looked up in.                      | `selectVariable`, `selectField` |
|              | **Floors below too**                                                              | The picker starts with **and below** ticked.                                                  | `mode`                          |
|              | **Fly to the floor picked**                                                       | Picking a floor flies the map to it. On by default.                                           | `zoomToFloor`                   |
|              | **Indoor from zoom**, **Outdoor below zoom**                                      | Where the map goes indoors and back out (17 and 16.5 by default; 0 never goes out).           | `minZoom`, `outdoorZoom`        |
|              | **Figure per floor**, **Adds up as**, **It counts**, **Amber from**, **Red from** | The figure on the picker and the cards.                                                       | `badge`                         |
| **Stacking** | **Spread between floors**                                                         | Metres between floors; 0 lays them all on the ground.                                         | `spacing`                       |
|              | **Other floors**                                                                  | Hidden, outlines of their rooms, or see-through (needs a spread).                             | `others`                        |
|              | **See-through**                                                                   | The other floors' opacity, 15 % by default.                                                   | `ghostOpacity`                  |
|              | **Floors above**                                                                  | Fade out as the map zooms in on the floor, seen through like the others, or hidden.           | `above`                         |
|              | **On the ground**                                                                 | Floor 0 as built, the floor picked, or the lowest floor.                                      | `groundFloor`                   |
| **Queries**  | One line per query                                                                | Follows the floor picked, every floor, only with some floors, or building facade.             | `queryFloors`                   |
| **Plans**    | **White to transparent**                                                          | From which lightness the plans' paper turns transparent (the Floor plan layer's own setting). | the layer's `planWhite`         |
|              | **Plans not on the map yet**                                                      | **Latitude**, **Longitude**, **Width (m)** and **Turned (°)** of plans without points.        | `planAnchor`                    |
| **Rooms**    | **Walls (m)**                                                                     | The walls' height, 1.2 m by default.                                                          | `planWalls`                     |
|              | **Data for the rooms**, **Matched by its column**                                 | The query whose rows are the rooms' data, and its room column.                                | `planRoomsData`                 |

The windows save the rest: each building's name, base and default floor (`buildingSettings`), each floor's name,
height, listing and floors shown with it (`floorSettings`), the floors added by hand (`declaredFloors`), the plans
(`plans`, `planPoints`), the rooms (`planRooms`, `mapRooms`) and the floors drawn (`floorOutlines`).

## In the dashboard's JSON

The options of the indoor tour's office map, as they are saved:

```json
"floors": {
  "enabled": true,
  "field": "level",
  "variable": "floor",
  "defaultFloor": "1",
  "spacing": 8,
  "others": "ghost",
  "ghostOpacity": 0.12,
  "plans": {
    "-1": "/public/plugins/ubica-keplerplus-app/floorplans/floor-m1.svg",
    "0": "/public/plugins/ubica-keplerplus-app/floorplans/floor-0.svg",
    "1": "/public/plugins/ubica-keplerplus-app/floorplans/floor-1.svg"
  },
  "floorSettings": { "0": { "height": 6 } },
  "queryFloors": { "C": ["0"] },
  "selectVariable": "room",
  "selectField": "room",
  "buildingSettings": { "": { "label": "Office building" } },
  "badge": { "field": "co2_ppm", "agg": "max", "warn": 1000, "alert": 1400, "label": "ppm CO2 at worst" }
}
```

A floor is keyed by its level (`"1"`, `"-1"`); with several buildings, by its building and level (`"MI/1"`). The
building of rows that name none is `""`. Query `C`, the site, shows only with the ground floor.
