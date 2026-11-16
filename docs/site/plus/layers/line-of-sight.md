# Line of Sight

Whether two places see each other: a radio link between two masts, a camera and the gate it watches, a lookout and a
landmark. Each row is a link from A to B, with an eye or an antenna over each end, and the layer draws the straight
line between the two, green where it passes, red past the first thing in its way: the terrain, a building, or the
earth's bulge on a long link. For a radio link it also checks the first Fresnel zone round the line.

![Radio links from a mast at the Turi lookout down to Cuenca: three green lines to the centre, the university and the airport, the airport's labelled "Clear by 7 m, Fresnel zone free · 4.8 km"; a short link in the centre runs green to a red dot and on in faint red, labelled "Blocked by a building at 168 m (2 m over the line)"](/img/plus/line-of-sight.jpg)

::: info Since Plus 1.7.0
The Line of Sight layer is new in Plus 1.7.0, not released yet.
:::

## What the query needs

One row per link, with its two ends. The heights can be fixed for the whole layer instead of columns:

| Column                  | Unit                                 | Notes                                                    |
| ----------------------- | ------------------------------------ | -------------------------------------------------------- |
| A latitude, A longitude | degrees                              | where the link starts; picked like a Line layer's source |
| B latitude, B longitude | degrees                              | where it ends                                            |
| A altitude, B altitude  | metres over the ground (or the roof) | optional: each end's mast or eye, per row                |

```sql
SELECT 'Turi to the airport' AS link,
       -2.92745 AS lat_a, -79.00495 AS lng_a, 25 AS mast_a,
       -2.88950 AS lat_b, -78.98400 AS lng_b, 15 AS mast_b
```

Without the altitude columns, **Height at A** and **Height at B** (2 m) apply to every link. With one, every row needs a
value in it: kepler leaves out a row whose altitude is empty. Up to 200 links are drawn, the first ones the filters
keep.

## What stands in the way

**Hidden by** picks what can block a link:

| Setting                       | Reads                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| **The terrain**               | Mapterhorn's terrain tiles, the same the Relief switch and the Route layer read                         |
| **Buildings**                 | the base map's buildings with their heights (OpenStreetMap's, from OpenFreeMap's tiles), on flat ground |
| **The terrain and buildings** | both, the default                                                                                       |

The building each end stands in is not in the way: an antenna on a roof, a camera on a façade, sees out of it. With
**Heights from** on **The roof, where one is** (the default), an end standing in a building is measured from its
roof, as a mast on top; **The ground** measures it from the street. A building without a height in OpenStreetMap
counts as 10 m. The building tiles a layer reads are capped at 64 (about 150 km of links in a city): past that, the
remaining links are judged on the terrain alone.

**Earth's curvature**, on by default, raises the middle of a link by the earth's bulge less the atmosphere's
refraction (k = 0.13, as the Viewshed layer): 0.4 m halfway along 5 km, 6.8 m along 20 km.

The profile is sampled every 2 m on a short link, and at 1,025 places on a long one (every 20 m along 20 km): a
building narrower than the spacing can slip between two samples.

## A radio link

Set **Radio frequency (MHz)** to the link's frequency (5800 for 5.8 GHz Wi-Fi, 900 for LoRa) and the line has to clear
more than itself: the first Fresnel zone, the ellipsoid round the line where most of the signal travels, has a
radius of 17.3 · √(d₁ · d₂ / (f · D)) metres (distances in km, f in GHz), 11.4 m halfway along 10 km at 5.8 GHz. A link
whose line clears everything but leaves less than **Fresnel zone clear (%)** of that radius free (60 %, the usual rule)
is **marginal**, drawn amber. 0 MHz checks the line of sight alone.

## How it is drawn

| Colour | The link                                                                       |
| ------ | ------------------------------------------------------------------------------ |
| green  | clear: nothing stands in the way (and the Fresnel zone is clear enough)        |
| amber  | marginal: the line passes, the Fresnel zone does not keep enough room          |
| red    | blocked: green up to the first obstruction, a red dot on it, faint red past it |
| grey   | the terrain or the building tiles along the link are still loading             |

The line stands at its height over the ground, a mast under each end: on a base map with relief over the relief (by
its exaggeration), on a flat map over the map, where the base map's 3D buildings stand against it as they do in the
profile. **Verdict labels**, on by default, write each link's verdict toward its B end: "Clear by 13 m · 3.0 km",
"Clear by 7 m, Fresnel zone free · 4.8 km", "Fresnel zone 31 % clear", or "Blocked by a building at 168 m (2 m over
the line)", where the room is the least the line keeps over the surface along the way. Labels that would cover one
another are thinned, a blocked link's first; zoom in to see the rest. **Opacity** and the line's width are in the
**Color** group.

A link's row shows in the popup on hover, as on any layer, with **Allow hover** on in the **Interaction** group.
