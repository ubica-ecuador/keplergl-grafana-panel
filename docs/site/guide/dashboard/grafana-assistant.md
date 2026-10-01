# Grafana Assistant

On a Grafana that has the **Grafana Assistant** (Grafana Cloud, and self-managed installations
where the Assistant app is available), the panel introduces itself: while a dashboard with a
kepler panel is open, the Assistant is handed a live digest of what the map is showing, and a
couple of starter questions appear in its sidebar. On a Grafana without the Assistant — OSS,
self-hosted without the app, or a version that predates it — the panel behaves exactly as before;
nothing is registered and nothing is sent anywhere.

This is not kepler's own AI assistant, which this panel deliberately leaves out — see
[Differences from stock kepler.gl](../../reference/differences-from-kepler). It is the panel
talking to Grafana's.

## What the Assistant sees

The page context carries, per kepler panel on the dashboard:

- **The datasets** — each query's refId and name, its row count, and every field with its type.
- **The base map id actually shown** — the saved `styleType`, or the panel's **Base map** option
  when the saved configuration names none.
- **The saved filters and the saved viewport** (latitude, longitude, zoom).
- **Always the dashboard's time range**, as absolute times — without it an assistant tends to
  assume "the last hour".

The digest follows the panel: it re-registers when the data, the panel options or the time range
change, and unregisters when the panel goes away. Filters and viewport are the map's last **saved**
state, not kepler's unsaved side-panel edits — save the map and the digest catches up.

The starter questions are registered once per dashboard, however many kepler panels it holds.
None of this calls a backend: the context lives in the browser and is read only when the
Assistant is opened.

## Teaching it the panel's schema

The Assistant can already edit the panel the way it edits any panel — the whole map lives in the
`mapConfig` panel option — but it edits better when it knows the schema. The panel ships a compact
skill text for that. Where your Grafana lets you give the Assistant standing instructions or
custom skills, paste this:

```text
# Kepler map configuration
The map is stored in the panel option 'mapConfig' ('config.mapStyle', 'config.visState',
'config.mapState'). Edit that JSON on the panel.
Base map: set 'config.mapStyle.styleType'. Free ids: no_map, dark-matter, positron, voyager,
grafana-satellite, grafana-satellite-terrain, grafana-topographic-terrain. Colour ramp:
'layer.config.visConfig.colorRange'. Filters: 'config.visState.filters'.
Cross-filter: this panel filters other panels via 'clickArea' (click a point for a circular
area) and can publish the viewport to dashboard variables ('viewportVariables'); it does not
support drawing a rectangle.
Data layers draw from the panel's Grafana queries: to add a layer that needs data, add a
query (refId) returning the columns, then a layer in 'config.visState.layers' whose dataId is
that query's dataset. The dataset id is grafana-<refId> (e.g., query B → grafana-B).
```

The same text is exported from the panel's code as `baseAssistantSkill`, and a test keeps it in
step with the panel — the base-map ids come from the panel's own registry, and the
`grafana-<refId>` dataset-id rule is asserted against the function that derives it. This page
quotes it; the export is the source of truth.

The dataset-id rule is the one thing worth remembering when writing layers by hand too: a layer
that needs data must name `dataId: "grafana-B"` to draw from query **B**.

## Authoring whole dashboards

An assistant asked to *build* a dashboard with this panel gets surprisingly far on its own — it
reads the panel's option names from the schema, writes the queries, and wires dashboard
variables. What it gets wrong, reliably, is the saved map's JSON shape. A second skill text
covers exactly that, and nothing more:

```text
# Authoring dashboards with the Kepler panel
The panel auto-detects query columns named latitude/longitude (or lat/lng), time, and a
track/trip id, and creates layers from them by itself — write a 'mapConfig' only to restyle
the map or add layers beyond the automatic ones.
'mapConfig' MUST be a kepler saved config with a top-level version key:
{"version":"v1","config":{"visState":…,"mapState":…,"mapStyle":…}}. Without "version" the
panel will silently ignore the whole mapConfig.
In a saved layer, 'visualChannels' is a SIBLING of 'config' — never inside it — while
'dataId', 'columns' and 'visConfig' live inside 'config'. Worked example (a point layer
coloured green→red by the 'kmh' column of query A):
{
 "version": "v1",
 "config": {
  "mapStyle": { "styleType": "dark-matter" },
  "mapState": { "latitude": -2.9, "longitude": -79.0, "zoom": 11 },
  "visState": {
   "filters": [],
   "layers": [
    {
     "id": "speed-points",
     "type": "point",
     "config": {
      "dataId": "grafana-A",
      "label": "Speed",
      "columns": { "lat": "latitude", "lng": "longitude" },
      "isVisible": true,
      "visConfig": {
       "radius": 6,
       "colorRange": {
        "name": "Custom", "type": "custom", "category": "Custom",
        "colors": ["#2ecc71", "#f1c40f", "#e74c3c"]
       }
      }
     },
     "visualChannels": { "colorField": { "name": "kmh", "type": "real" }, "colorScale": "quantile" }
    }
   ]
  }
 }
}
The panel applies 'mapConfig' when the dashboard loads; if a live edit does not show on the
open dashboard, reload the page once.
If the data is historical, save an absolute dashboard time range that covers it — a relative
range like now-6h shows an empty map.
```

Paste it alongside the base text above. In code it is exported as `dashboardAuthoringSkill`,
and its worked example is held to the panel by tests: the JSON must pass the panel's own
config parser, and the layer's `dataId` must match the real `datasetId()`. As with the base
text, the export is the source of truth; this page quotes it. (The JSON block above is
formatted for reading — the export embeds the same object, machine-formatted.)

## For app plugins built on this panel

An app that embeds this panel can *compose* onto its Assistant contribution instead of competing
with it:

- Import `baseAssistantSkill` and fold it into the app's own skill.
- Wrap the panel in the exported `AssistantComposition` React context to extend the digest
  (`extendDigest`) or retitle the context item (`title`) — with no provider, the panel registers
  its own digest as described above. Pass stable values: the registration refreshes when the
  digest's inputs change.
