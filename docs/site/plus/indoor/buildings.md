# Buildings and sites

One indoor map can hold a campus, a hospital estate, an airport's terminals or a portfolio of buildings across a
country. Floors keeps each building's floors apart, shows the floors of the building you look at, and, zoomed out,
stands each building as a card with its figure. A click goes one level in, from the world to a site, a building, its
floor and a room, and a breadcrumb over the map goes back out.

![The TUM Garching campus zoomed out, its buildings in grey 3D, with a card over the Mechanical Engineering building reading 28 rooms in a lecture and one over Mathematics and Informatics reading 34, and a breadcrumb over the map reading All buildings](/img/plus/floors-campus.jpg)

::: info Since Plus 1.7.0
Buildings and sites on an indoor map are new in Plus 1.7.0, not released yet.
:::

The map above is the Technical University of Munich's campus in Garching: the rooms of two buildings from
OpenStreetMap's indoor tagging, each coloured by whether a lecture is on in it, from the university's room calendar.
It is live: [TUM Garching through a day of lectures](https://pacha.ubica.dev/d/tum-garching-lectures), public and
read-only. Zoom in on a building, or pick a lecture in the table beside the map.

## A building column

Give the rows a column naming their building: `building`, `building_id`, `building_name`, `structure`, `facility`,
`edificio` or `bloque`, or another chosen in **Settings** → **Data** → **Building column**. Each building then has
floors of its own: floor 1 of the library is not floor 1 of the lab.

The building you look at is the one nearest the middle of the view: as you pan to another, the picker lists its
floors. It does not flip back and forth between two buildings close together: another building must be clearly nearer
before it takes over. The picker's first line chooses the building by hand: **Nearest** follows the view, a building's
name keeps that one.

**Settings** → **Picker** → **Building variable** writes the building looked at to a dashboard variable, and follows
it: a dropdown or a link with `var-building=Library` takes the map there.

## Each building its own

A building's name in the Indoor tab opens its window:

- **Name**: the name the picker, the cards and the breadcrumb show, in place of the column's value (`MI` becomes
  _Mathematics and Informatics_).
- **Base (m)**: how far its lowest floor stands above the other buildings', for a building up a hill. It is not spread
  with the floors.
- **Default floor**: the floor it shows while another building is looked at, and when the map is zoomed out.

While you look at one building, the others show their default floor (**Settings** → **Picker** →
**Other buildings**: **On their default floor**), every floor, or nothing (**Hidden**). Each building's floors keep
their own heights: picking the third floor of one does not lift the other.

## Facades

A building's shell, as an extruded footprint from OpenStreetMap or your own outlines, can stand for the buildings you
are not inside. Set its query to **Building facade: the other buildings, and zoomed out** in **Settings** →
**Queries**: the shells of every building show zoomed out, and those of the others while you look at one; the
building you look at shows its floors instead. A facade query needs the building column too, so each shell is known
to belong to its building.

## Zoomed out

Floors goes indoors at a zoom: 17 by default, a building of a few hundred metres filling a few hundred pixels. Zoomed
out past it:

- the picker hides, and every building shows its default floor, or its facade;
- each building stands as a card with its name and its [figure](./#a-figure-per-floor) over all its floors, and how
  many rows are amber and red;
- a click on a card flies in to the building, on its default floor.

**Settings** → **Picker** → **Zoomed out** sets the zooms: **Indoor from zoom** and **Outdoor below zoom** (half a
level lower by default). Two thresholds, so a map resting near one does not flip back and forth. An indoor zoom of 0
keeps the map indoors at every zoom, with no cards.

### Sites

With a column naming each building's site (a city, a campus, a region: `site`, `site_name`, `campus`, `city`,
`region`, `sede`, `ciudad`), the buildings of a site close together on the screen gather into one card, the site's,
and cards that would overlap gather into one. A click flies one level in: a site to its buildings, a building to its
floor. The breadcrumb over the map names where you are, _All sites › Quito › Hospital North › Floor 4_, and each of
its names goes back out to it.

### From one building to the next

Indoors, the other buildings keep a small card with their name and figure, so you can go from one to the next without
zooming out: those of the site of the building you look at or, with no sites, those within a kilometre, the six
nearest. A building in view has its card over it; one out of view is pinned to the edge of the map where the way to it
leaves the view, with an arrow. A click on a card flies in to that building, on its default floor, and lets a
[selection](#go-to-a-room-or-a-sensor) in the building you leave go. **Settings** → **Picker** → **Their cards
indoors** → **Hidden** turns them off.

## Floors shown together

Some floors are seen together: a mezzanine with its hall, the galleries round an atrium. In a floor's window, on
**Floor**, **Shown with it** lists the other floors of its building: those ticked show with it whenever it is picked.

## Go to a room or a sensor

![The Mathematics and Informatics building's first floor, flown in to from the campus: its rooms in their colours, each room with a lecture on as a callout with the minutes left, the picker listing the building's five floors with the rooms in a lecture on each, and the breadcrumb reading All buildings › Mathematics and Informatics › 1st floor](/img/plus/floors-campus-floor.jpg)

A **Selection variable** names one thing on the map, on whichever building and floor it is: a room, a sensor, a
machine. Set from outside (a link, the URL, a table's data link, another panel), the map goes to its building and
floor, flies to it and rings it, and the breadcrumb ends with its name and a ×, which lets it go.

In **Settings** → **Picker**:

- **Selection variable**: the variable's name, such as `room`.
- **Matched by**: the column the variable's value is looked up in; by default the first of `code`, `id`, `room`,
  `room_name`, `sensor`, `sensor_id`, `asset` or `name` the rows have.

A table of rooms whose names link to the same dashboard with `var-room=${__data.fields.room}` turns the table into a
finder: a click on a row takes the map to that room. A value of the form `@latitude,longitude` (with `,zoom` after it
if you like) goes to a place instead, for a point that is no row of the map.

The selection is a variable like the floor, so the other panels can follow it, and a shared link opens on it.

## When it does not draw

- **Every building's floors are mixed together.** The rows have no building column Floors recognises: set
  **Building column** in **Settings** → **Data**.
- **No cards zoomed out.** The map is not zoomed out past the indoor zoom, or the indoor zoom is 0. A card's figure
  needs **Figure per floor** set.
- **The picker shows the wrong building.** The view's middle is nearer another one: pan to the building, or pick it in
  the picker's first line.
- **The selection variable does nothing.** Its value is in no row's **Matched by** column, or the variable's name is
  not the one set. The value must match exactly, case included, and the row must have the floor column.
