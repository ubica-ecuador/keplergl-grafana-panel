# Night and day

A city does not go dark at night: its streets light up. Plus can make the base map follow the sun at the place
shown, with three sections of kepler's **Base map** tab, under **Map Layers**:

- **Day and night**: one style while the sun is up, another once it is down;
- **Building shadows**: the base map's 3D buildings cast kepler's Light & Shadow shadows;
- **Street lights**: lamps light the streets at night.

![The centre of Madrid at 22:00 on Fiord: the 3D buildings in the night's blue, the streets and squares between them warm with the light of their lamps, the avenues brightest](/img/plus/night-street-lights.jpg)

::: info Since Plus 1.7.0
The three sections are new in Plus 1.7.0, not released yet.
:::

They are on OpenFreeMap's five styles (Positron, Bright, Liberty, Dark and Fiord), each off until turned on, and
saved with the map.

## Which sun

The three follow the same sun, at the centre of the view:

- on a map with kepler's **Light & Shadow** effect, the effect's time, chosen as for the
  [Buildings layer's shadows](/plus/layers/buildings#light-and-shadow): a time picked in the effect, the current time,
  or in **animation** the end of the map's time filter window or of the dashboard time range;
- on a map without it, the end of the dashboard time range.

So on a live dashboard whose range ends now, the map follows the real sun, and a
[Time Brush](/plus/time-brush) or the time picker moves it. It is night from when the sun stands less than a degree
above the horizon, the moment Light & Shadow turns to night: in Madrid in late November from about 17:40 to 08:20.

## Day and night

Turn on **Follow the sun** and pick the style **By day** and the style **At night**, among OpenFreeMap's five:
Liberty and Fiord at first.

![The same streets at 13:00 on Liberty](/img/plus/day-and-night-liberty.jpg)

- Both styles are read when the map opens, so the switch at dusk and at dawn draws the other style in under a
  second; the map's tiles load again once then.
- A style picked in **Map Style** while the rule is on becomes the style of that time of day: picked at night, the
  night's. A style the rule cannot use (CARTO's, Azure's, Google's, your own) turns it off.
- A map saved at night is saved on the night's style; it opens on the right one for its time all the same.

The Map Style picker shows the style in use, the night's at night.

## Building shadows

MapLibre draws the base map's 3D buildings, and casts no shadow: kepler's Light & Shadow lights and shades only what
deck.gl draws. Turn on **Cast shadows** and Plus draws the style's own 3D buildings itself, from the same OpenFreeMap
tiles, and hides the style's: the map looks the same, and its buildings cast their shadows on the streets and on each
other.

![The centre of Madrid at 16:30 on Liberty: the low sun from the south-west, every building's shadow falling across the streets and the roofs beside it](/img/plus/building-shadows.jpg)

It needs the **Light & Shadow** effect (map control, top right; see [Effects](/guide/kepler/effects)). On a map with a
[Buildings](/plus/layers/buildings) or [City Model](/plus/layers/city-model) layer it does nothing: those draw the
buildings, and cast their shadows, themselves.

| Setting                    | What it does                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| **Opacity**                | The buildings' opacity, 0 to 1.                                                                 |
| **Shade on their faces**   | How far the light and the shade fall on the buildings' walls: 0 (every face in its colour) to 1. |
| **In the base map's colour** | On: the style's building colour, which follows Day and night. Off: a colour **By day** and one **At night**. |

At night the buildings keep their colour, the night's style's or the one picked for the night, under a faint light
from high on the side opposite the sun, so their roofs and walls still read apart. They are drawn from zoom 12, out to
about 3.5 km from the centre of the view, as the Buildings layer draws them. Leave it off with **Relief** on: the
buildings it draws stand at sea level, under the terrain.

## Street lights

OpenStreetMap maps few of a city's lamps (in central Madrid about 2,600 in 11 km², in Cuenca a couple of hundred),
but every street. So Plus puts the lamps along the streets of OpenFreeMap's tiles: every 15 to 30 m by the street's
class, closer on the main roads, on alternate sides, and only where there are buildings near, so a road across the
fields stays dark. Footways and pedestrian streets are lit; tunnels, tracks and cycle paths are not.

The lamps come on as the sun sets, from a degree above the horizon, and are all on 5° later, about when a city's
photocells have all switched. Each lights a pool of the ground: the light lies over the roads, the pavements and the
flat footprints, under the 3D buildings, the names and kepler's layers. From afar the city glows as seen from the air.

![Madrid from above at 22:00 on Dark, with no Light & Shadow: the streets of every neighbourhood traced in warm light, the parks and the railway yards dark](/img/plus/night-city-from-above.jpg)

| Setting            | What it does                                                                  |
| ------------------ | ----------------------------------------------------------------------------- |
| **Intensity**      | How bright, 0 to 3.                                                           |
| **Pool of light**  | The size of each lamp's pool, 0.3 to 3 times its own.                         |
| **Lamps**          | Sodium (orange, 2000 K), warm white LED (3000 K) or neutral white LED (4000 K). |
| **By day too**     | Lit by day as well, to set them up without waiting for the night.             |

A light base map shows little of them: use them with a dark style, or with Day and night. They are drawn from zoom 12,
out to about 3.5 km from the centre of the view; not on the globe, nor with **Relief** on, whose terrain would bury
them. With Building shadows on, the ground the shadows fall on leaves the streets their light at night.

## In a provisioned dashboard

The three sections are saved in the map's `mapStyle.visibleLayerGroups`, each under its own key. A map on Liberty by
day and Fiord at night, its buildings casting shadows and its streets lit, with Light & Shadow following the dashboard
time range:

```json
{
  "mapStyle": {
    "styleType": "openfreemap-liberty",
    "visibleLayerGroups": {
      "label": true,
      "road": true,
      "building": true,
      "water": true,
      "land": true,
      "dayNightStyles": { "on": true, "day": "openfreemap-liberty", "night": "openfreemap-fiord" },
      "buildingShadows": { "on": true, "opacity": 1, "shade": 1, "styleColour": true },
      "streetLights": { "on": true, "intensity": 1, "reach": 1, "colour": "warm", "always": false }
    }
  },
  "visState": {
    "effects": [
      { "id": "light-and-shadow", "type": "lightAndShadow", "isEnabled": true, "parameters": { "timeMode": "animation" } }
    ]
  }
}
```

With `"styleColour": false`, `buildingShadows` takes `colour` and `nightColour` as `[r, g, b]`. `colour` in
`streetLights` is `sodium`, `warm` or `neutral`.
