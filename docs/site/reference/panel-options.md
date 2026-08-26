# Panel options

Every option the panel exposes, in the order the editor groups them. `Path` is the key in the panel
JSON, which is what you need for dashboards-as-code.

## Field mapping

| Option        | Path            | Default       | Notes                                                                                                                                                           |
| ------------- | --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field mapping | `fieldMappings` | autodetection | Per query, keyed by `refId`. Detected values appear as placeholders; set one to override, or **None** to switch the role off. See [Field roles](./field-roles). |

## Map

| Option                         | Path                  | Default    | Notes                                                                                                                                                                                                             |
| ------------------------------ | --------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Show side panel                | `showSidePanel`       | `true`     | kepler's layer and filter panel. Worth hiding on small tiles.                                                                                                                                                     |
| Follow dashboard theme         | `followGrafanaTheme`  | `true`     | Restyles kepler's chrome from the Grafana theme, and drives _Match theme_ on the base map. See [Theme](../guide/map/theme).                                                                                       |
| Time range sync                | `timeSync`            | `toMap`    | `toMap`, `bidirectional`, `variables`, `off`. See [Time range sync](../guide/dashboard/time-range-sync).                                                                                                          |
| Time window variables          | `timeVariables`       | —          | **Only shown when `timeSync` is `variables`.** The two variables the slider's window is published to, as UTC ISO 8601. See [Time window variables](../guide/dashboard/time-window-variables).                     |
| Update variables while playing | `publishWhilePlaying` | `false`    | **Only shown when `timeSync` is `variables`.** Writes the window during playback rather than only when it stops. Costs the animation frames.                                                                      |
| Sync time with other maps      | `peerTimeSync`        | `false`    | Shares the time filter and trip playhead with the other maps on the dashboard that have this on, in the browser. See [Peer time sync](../guide/dashboard/peer-time-sync).                                         |
| Trip layer                     | `tripLayerMode`       | `table`    | `table` keeps one row per point and every column with it; `geojson` folds each trip into one row and keeps only the path. See [Trajectories](../guide/data/trajectories).                                         |
| Flow line style                | `flowRenderMode`      | `straight` | `straight`, `curved`, `animated-straight`. See [Origin–destination flows](../guide/data/flows).                                                                                                                   |
| Wind line density              | `windDensity`         | `9000`     | Streamlines per full screen, shared between the velocity-field layers on it. Range 500–20,000, step 500. See [Velocity fields](../guide/data/velocity-fields).                                                    |
| Base map                       | `basemap`             | `auto`     | `auto`, `dark-matter`, `positron`, `voyager`, `grafana-satellite`, `grafana-satellite-terrain`, `grafana-topographic-terrain`, `custom`. See [Base maps and relief](../guide/map/basemaps-and-relief).            |
| Style URL                      | `customBasemapUrl`    | —          | **Only shown when `basemap` is `custom`.** A MapLibre `style.json` served from your own network.                                                                                                                  |
| Raster tile server             | `rasterServerUrl`     | `https://titiler.xyz` | TiTiler-compatible server that turns a COG into tiles, for queries returning a `raster_url` column. It reads the imagery on the map's behalf, so it has to be able to reach it — the public default cannot see anything private, and is handed the URL you point it at. A `.pmtiles` URL needs no server and ignores this. See [Field roles](./field-roles). |

## Cross-filtering

| Option                              | Path                | Default | Notes                                                                                                                              |
| ----------------------------------- | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cross-filtering                     | `variableMappings`  | —       | A list. Each row binds a column or a click to a dashboard variable. See [Cross-filtering](../guide/dashboard/cross-filtering).     |
| Publish drawn area                  | `areaVariable`      | —       | Writes the drawn polygon or rectangle to a variable as WKT in EPSG:4326. One way. See [Publishing](../guide/dashboard/publishing). |
| Publish viewport (for other panels) | `viewportVariables` | —       | Four variables for the bounding box edges. See [Publishing](../guide/dashboard/publishing).                                        |

### The shape of a `variableMappings` entry

| Key          | Meaning                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| `field`      | the column the mapping is about; meaningless for `coordinate` and `center`       |
| `variable`   | the variable that receives the value — or the **latitude** for a coordinate pair |
| `variableTo` | the upper bound of a numeric range — or the **longitude** for a coordinate pair  |
| `source`     | `filter` (default), `click`, `coordinate`, `center`                              |
| `zoom`       | for `center` only: the zoom to jump to. Absent, the map keeps its zoom           |

A mapping with both `variable` and `variableTo` and no `source` is a **range** mapping: the numeric
filter on `field` publishes its min and max as a pair.

## Map configuration

| Option               | Path          | Default | Notes                                                                                                                          |
| -------------------- | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Map configuration    | `saveRequest` | —       | The **Save current map** button. It is a counter, not a boolean, so repeated saves register.                                   |
| Import configuration | `mapConfig`   | —       | The stored configuration itself, and the textarea for pasting one in. See [Map configuration](../guide/map/map-configuration). |

::: tip Why the save button is a counter
Grafana gives panel option editors no channel to the panel component, and the map state lives in the
panel's own Redux store. So the editor bumps a counter and the panel — which can see its store —
does the capture.
:::

## Options this panel ignores

Grafana's standard field options — unit, decimals, colour scheme, thresholds, value mappings, data
links — do not affect the map. Colour comes from kepler's layer configuration; see
[Colour palettes and scales](../guide/kepler/colour-palettes-and-scales).

Data links are worth a specific note: a data link _on another panel_ pointing at this one's variables
is the basis of the **Center** mapping, and that works well. Data links configured on this panel do
nothing.
