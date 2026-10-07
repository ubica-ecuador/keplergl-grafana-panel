# Grafana Assistant

With [Grafana Assistant](https://grafana.com/docs/grafana-cloud/platform/grafana-assistant/), anyone who opens a
dashboard with a Plus map can ask about the map, or ask for a change to it, in plain words. The Plus app teaches the
Assistant what a Plus map can do, and every open Plus map tells it what it is showing.

Nothing needs setting up in Plus. When Grafana Assistant is available on your Grafana, the app registers its skills
with it; see Grafana's documentation for where the Assistant is available. Without the Assistant, nothing in the
panel changes.

## What each map tells the Assistant

While a dashboard is open, each Plus map on it reports, as **Kepler Plus map — _panel title_ (live)**:

- each query's fields, with their types, and its number of rows;
- the base map, and whether its Relief switch is on;
- the filters saved in the map;
- the area in view;
- the dashboard's time range.

So a question such as _"what is this map showing?"_ or _"which fields could I colour by?"_ is answered from what is
on screen, without running a query.

## The Plus skills

The app adds three skills to the Assistant, next to the free panel's own knowledge of kepler's saved map:

| Skill                                    | What it covers                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configure a Kepler Plus map              | The Plus base maps by their real names, the Relief and other Map Layers switches, Places and active alerts options, and linking the map to the other panels |
| Kepler Plus layer types                  | The eight [Plus layers](/plus/layers/): the columns each one reads, its settings, and what it is for                                                        |
| Author dashboards with a Kepler Plus map | Writing a dashboard around a Plus map: the saved map, its layers, the variables and the other panels' queries                                               |

Because the skills list the base maps Plus can draw, the Assistant does not invent a style the panel cannot show. The
Plus base maps still draw only when the organisation has the provider's key; see
[Install and configure the app](/plus/start/install#the-configuration-page).

## What you can ask

**Change the map.**

- _"Switch to Esri imagery with relief."_
- _"Colour the stations by turbidity."_
- _"Filter the last hour."_

**Add Plus layers.**

- _"Gauges for the sites, red above 90 %."_
- _"Turn the links into Traffic with two-way lanes."_
- _"A surface of the temperature with isolines."_

**Link the map to the dashboard.** The Assistant creates the variables, sets the map's options and writes the other
panels' queries that read them.

- _"Filter the other panels by the area I draw."_
- _"Publish the time slider to variables."_
- _"Make the cards follow the charts' crosshair."_

**Build a dashboard around a map.**

- _"A map of the substations with a time series of their load, filtered by clicking a substation."_

On a dashboard with a Plus map, the Assistant also offers three ready-made prompts: **Explain this map**, **Base map +
relief** and **Link to other panels**.

## What it can and cannot change

The Assistant edits dashboards: the map's saved configuration, its panel options, the dashboard's variables and the
other panels. The skills do not touch the organisation's map service keys: only an administrator changes them, on
the app's configuration page.

It sees only the dashboard you have open and the data you are allowed to query.
