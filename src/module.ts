import { FieldConfigProperty, PanelPlugin } from '@grafana/data';
import { config } from '@grafana/runtime';
import { GAZETTEERS } from './data/placeLookup';

import { KeplerPanelOptions } from './types';
import { KeplerPanel } from './panel/KeplerPanel';
import { fromGeomapPanel } from './geomap/fromGeomap';
import { SaveMapConfigEditor } from './editors/SaveMapConfigEditor';
import { MapConfigEditor } from './editors/MapConfigEditor';
import { HoverLayerEditor } from './editors/HoverLayerEditor';
import { FieldMappingEditor } from './editors/FieldMappingEditor';
import { RouteQueriesEditor } from './editors/RouteQueriesEditor';
import { VariableSyncEditor } from './editors/VariableSyncEditor';
import { TimeVariableEditor } from './editors/TimeVariableEditor';
import { AreaVariableEditor } from './editors/AreaVariableEditor';
import { DEFAULT_CLICK_AREA_METRES } from './panel/clickArea';
import { ViewportVariablesEditor } from './editors/ViewportVariablesEditor';
import { FitVariablesEditor } from './editors/FitVariablesEditor';
import { AdHocFieldsEditor } from './editors/AdHocFieldsEditor';
import { PlayheadVariableEditor } from './editors/PlayheadVariableEditor';
import { RASTER_SERVER_PLACEHOLDER } from './panel/constants';
import { DEFAULT_PUBLISH_INTERVAL_MS, MIN_PUBLISH_INTERVAL_MS } from './panel/timeVariableSync';
import { DEFAULT_LIVE_INTERVAL_MS, MIN_LIVE_INTERVAL_MS } from './panel/useLiveSeries';

export const plugin = new PanelPlugin<KeplerPanelOptions>(KeplerPanel).setPanelOptions((builder) =>
  builder
    .addCustomEditor({
      id: 'fieldMappings',
      path: 'fieldMappings',
      name: '',
      description: 'Columns are detected automatically; override them here when the guess is wrong.',
      category: ['Field mapping'],
      editor: FieldMappingEditor,
    })
    .addBooleanSwitch({
      path: 'showSidePanel',
      name: 'Show side panel',
      description: "kepler's layer and filter panel. Worth hiding on small tiles.",
      category: ['Map'],
      defaultValue: true,
    })
    .addBooleanSwitch({
      path: 'followGrafanaTheme',
      name: 'Follow dashboard theme',
      category: ['Map'],
      defaultValue: true,
    })
    .addSelect({
      path: 'timeSync',
      name: 'Time range sync',
      description: "Couple the dashboard time range with the map's time filter.",
      category: ['Map'],
      defaultValue: 'toMap',
      settings: {
        options: [
          { value: 'toMap', label: 'Dashboard drives map' },
          { value: 'bidirectional', label: 'Both directions' },
          { value: 'variables', label: 'Slider writes variables' },
          { value: 'off', label: 'Off' },
        ],
      },
    })
    .addCustomEditor({
      id: 'timeVariables',
      path: 'timeVariables',
      name: 'Time window variables',
      description:
        "The time slider's window is published to these two variables instead of moving the dashboard time range, so the map keeps its whole dataset and the slider keeps showing it.",
      category: ['Map'],
      editor: TimeVariableEditor,
      showIf: (config) => config.timeSync === 'variables',
    })
    .addBooleanSwitch({
      path: 'publishWhilePlaying',
      name: 'Update variables while playing',
      description:
        'Write the window to the variables as the animation runs, not just when it stops. Every update re-runs the panels that read the variables, which costs the animation some smoothness.',
      category: ['Map'],
      defaultValue: false,
      showIf: (config) => config.timeSync === 'variables',
    })
    .addCustomEditor({
      id: 'playheadVariable',
      path: 'playheadVariable',
      name: 'Playhead variable',
      description:
        "Write the trip animation's current instant to a dashboard variable, so other panels can follow it. Works with any time range sync.",
      category: ['Map'],
      editor: PlayheadVariableEditor,
    })
    .addNumberInput({
      path: 'publishIntervalMs',
      name: 'Minimum interval while playing (ms)',
      description:
        "Least time between two updates of the variables during playback: the time window's, and the trip playhead's. With a datasource that reports when its panels have answered, each update also waits for those panels, for up to five seconds.",
      category: ['Map'],
      defaultValue: DEFAULT_PUBLISH_INTERVAL_MS,
      settings: { min: MIN_PUBLISH_INTERVAL_MS, integer: true },
      showIf: (config) =>
        Boolean(config.playheadVariable) || (config.timeSync === 'variables' && Boolean(config.publishWhilePlaying)),
    })
    .addBooleanSwitch({
      path: 'peerTimeSync',
      name: 'Sync time with other maps',
      description:
        "Share this map's time filter and trip playhead with the other maps on the dashboard that have this on. Runs in the browser, so animating one map moves the rest without re-running any query.",
      category: ['Map'],
      defaultValue: false,
    })
    .addBooleanSwitch({
      path: 'liveFollow',
      name: 'Follow live data',
      description:
        'While a query streams (Grafana Live, MQTT), keep the trip playhead and the time window on the newest rows. Move either away from the end and it stays there until you bring it back.',
      category: ['Live data'],
      defaultValue: true,
    })
    .addNumberInput({
      path: 'liveIntervalMs',
      name: 'Live update interval (ms)',
      description:
        'While a query streams, update the map at most this often. Every update rebuilds the dataset, so a datasource that sends several messages a second is cheaper to draw at one update a second.',
      category: ['Live data'],
      defaultValue: DEFAULT_LIVE_INTERVAL_MS,
      settings: { min: MIN_LIVE_INTERVAL_MS, integer: true },
    })
    .addRadio({
      path: 'grafanaAnnotations',
      name: 'Grafana annotations',
      description:
        'Draw the dashboard annotations that have a place (a geo:<lng>,<lat> tag) as notes on the map, shown while their time is in the map window. Show and save also turns a note made with right-click "Add Annotation" into a Grafana annotation over the map window, which the time charts draw.',
      category: ['Map'],
      defaultValue: 'show',
      settings: {
        options: [
          { value: 'off', label: 'Off' },
          { value: 'show', label: 'Show' },
          { value: 'both', label: 'Show and save' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'hoverSync',
      name: 'Show position on graph hover',
      description:
        'Follow the shared cursor of Grafana graphs. Enable Shared crosshair or Shared tooltip in dashboard settings.',
      category: ['Temporal cursor'],
      defaultValue: false,
    })
    .addBooleanSwitch({
      path: 'hoverPublishSpike',
      name: 'Map hover drives graphs (experimental)',
      description:
        'Hovering a Point layer’s sample or the map’s time bar moves the graphs’ shared cursor. Trip paths are not supported in this direction yet.',
      category: ['Temporal cursor'],
      defaultValue: false,
      showIf: (config) => Boolean(config.hoverSync),
    })
    .addCustomEditor({
      id: 'hoverLayerId',
      path: 'hoverLayerId',
      name: 'Layer',
      category: ['Temporal cursor'],
      editor: HoverLayerEditor,
      showIf: (config) => Boolean(config.hoverSync),
    })
    .addNumberInput({
      path: 'hoverMaxAgeSeconds',
      name: 'Maximum sample age (seconds)',
      description: 'Hide positions older than this. A cursor also disappears outside its trip’s time span.',
      category: ['Temporal cursor'],
      defaultValue: 60,
      settings: { min: 0 },
      showIf: (config) => Boolean(config.hoverSync),
    })
    .addSelect({
      path: 'tripLayerMode',
      name: 'Trip layer',
      description:
        'Table columns keeps one row per point, so speed, mode and every other column stay available for colour, filters and tooltips. GeoJSON folds each trip into a single row: far less data, but only the path survives.',
      category: ['Map'],
      defaultValue: 'table',
      settings: {
        options: [
          { value: 'table', label: 'Table columns' },
          { value: 'geojson', label: 'GeoJSON' },
        ],
      },
    })
    .addSelect({
      path: 'gazetteer',
      name: 'Place names',
      description:
        'Where a query that names places instead of giving coordinates (a Place name column in Field mapping) finds them. A URL of your own works too.',
      category: ['Map'],
      defaultValue: GAZETTEERS.countries,
      settings: {
        allowCustomValue: true,
        options: [
          { value: GAZETTEERS.countries, label: 'Countries (name, 2- or 3-letter code)' },
          { value: GAZETTEERS.usaStates, label: 'US states (name or code)' },
          { value: GAZETTEERS.airports, label: 'Airports (IATA or ICAO code)' },
        ],
      },
    })
    .addSelect({
      path: 'dayNight',
      name: 'Night shading',
      description: 'Shades the side of the Earth in darkness, at the end or the start of the dashboard time range.',
      category: ['Map'],
      defaultValue: 'off',
      settings: {
        options: [
          { value: 'off', label: 'Off' },
          { value: 'to', label: 'At the end of the range' },
          { value: 'from', label: 'At the start of the range' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'dayNightSun',
      name: 'Show the sun',
      description: 'The point on Earth the sun stands over.',
      category: ['Map'],
      defaultValue: false,
      showIf: (config) => (config.dayNight ?? 'off') !== 'off',
    })
    .addCustomEditor({
      id: 'routeQueries',
      path: 'routeQueries',
      name: 'Draw as a route',
      description: 'Queries whose rows are joined in order into one line.',
      category: ['Map'],
      editor: RouteQueriesEditor,
    })
    .addSelect({
      path: 'flowRenderMode',
      name: 'Flow line style',
      description: 'How origin-destination flow layers draw their lines.',
      category: ['Map'],
      defaultValue: 'straight',
      settings: {
        options: [
          { value: 'straight', label: 'Straight' },
          { value: 'curved', label: 'Curved' },
          { value: 'animated-straight', label: 'Animated' },
        ],
      },
    })
    .addSelect({
      path: 'basemap',
      name: 'Base map',
      description: 'Base maps served without a Mapbox token.',
      category: ['Map'],
      defaultValue: 'auto',
      settings: {
        options: [
          { value: 'auto', label: 'Match theme' },
          { value: 'openfreemap-positron', label: 'Positron (OpenFreeMap)' },
          { value: 'openfreemap-bright', label: 'Bright (OpenFreeMap)' },
          { value: 'openfreemap-liberty', label: 'Liberty (OpenFreeMap)' },
          { value: 'openfreemap-dark', label: 'Dark (OpenFreeMap)' },
          { value: 'openfreemap-fiord', label: 'Fiord (OpenFreeMap)' },
          { value: 'dark-matter', label: 'Dark Matter (CARTO)' },
          { value: 'positron', label: 'Positron (CARTO)' },
          { value: 'voyager', label: 'Voyager (CARTO)' },
          { value: 'grafana-satellite', label: 'Satellite (Esri)' },
          { value: 'grafana-satellite-terrain', label: 'Satellite + relief' },
          { value: 'grafana-topographic-terrain', label: 'Topographic + relief' },
          { value: 'custom', label: 'Self-hosted style.json' },
        ],
      },
    })
    .addTextInput({
      path: 'customBasemapUrl',
      name: 'Style URL',
      description:
        'MapLibre style.json served from your own network — required for air-gapped installs. Dashboard variables are interpolated, and a path relative to the dashboard is resolved against it.',
      category: ['Map'],
      settings: { placeholder: 'https://tiles.internal/style.json' },
      showIf: (config) => config.basemap === 'custom',
    })
    .addTextInput({
      path: 'cartoApiKey',
      name: 'CARTO API key',
      description:
        'Only for the CARTO base maps (Dark Matter, Positron, Voyager). Free at carto.com/basemaps/apikey; public by design, it travels in every tile URL. Dashboard variables are interpolated.',
      category: ['Map'],
      settings: { placeholder: 'Optional' },
    })
    .addTextInput({
      path: 'rasterServerUrl',
      name: 'Raster tile server',
      description:
        'TiTiler-compatible server that turns a COG or a Zarr store into tiles, for queries returning a raster_url or zarr_url column. None is set by default, and until one is, those queries draw nothing. It reads the imagery on the map\u2019s behalf and is handed every url, signature included, so use a server you run; Development Seed\u2019s public demo, https://titiler.xyz, reads public imagery only. A .pmtiles url needs no server and ignores this.',
      category: ['Map'],
      settings: { placeholder: RASTER_SERVER_PLACEHOLDER },
    })
    .addBooleanSwitch({
      path: 'rasterPainted',
      name: 'Let the tile server paint',
      description:
        'Ask the server for finished pictures instead of raw values. Needed for a classified raster \u2014 land cover, soils \u2014 whose colours are a fact of the data: the ramp below cannot express nine named classes, and the browser rescales the class numbers over the whole data-type range, which lands every class on the same colour. The server reads the palette the file carries instead. What arrives is already drawn, so nothing about its colour can be changed afterwards. Leave off for imagery.',
      category: ['Map'],
      defaultValue: false,
    })
    .addSelect({
      path: 'rasterBands',
      name: 'Raster bands',
      description:
        'Which bands of a scene to draw, for a query that also returns a raster_item_url column pointing at its STAC item. True colour draws the composed image the query already names. The composites are built by the tile server in one request; the indices are computed in the browser from two bands and coloured with a ramp. A dashboard variable is interpolated here, so a dropdown can drive it.',
      category: ['Map'],
      defaultValue: '',
      settings: {
        allowCustomValue: true,
        options: [
          { value: '', label: 'True colour (the composed image)' },
          { value: 'forestBurn', label: 'Forest burn — SWIR2 · NIR · blue' },
          { value: 'infrared', label: 'Infrared — NIR · red · green' },
          { value: 'nbr', label: 'NBR — burn severity' },
          { value: 'ndmi', label: 'NDMI — moisture' },
        ],
      },
    })
    .addSelect({
      path: 'rasterColormap',
      name: 'Raster colour ramp',
      description:
        "Colour ramp for rasters a query produces. kepler's default is built for drone NDVI and steps through unrelated colours, which reads as noise on a continuous field. A whole ramp can be typed in as JSON \u2014 TiTiler's own intervals \u2014 which is the only way to make the low end transparent, as a field that is mostly near zero needs.",
      category: ['Map'],
      defaultValue: '',
      settings: {
        allowCustomValue: true,
        options: [
          { value: '', label: "kepler's default (Cfastie)" },
          { value: 'blues', label: 'Blues — white to blue' },
          { value: 'greens', label: 'Greens' },
          { value: 'reds', label: 'Reds' },
          { value: 'viridis', label: 'Viridis' },
          { value: 'magma', label: 'Magma' },
          { value: 'greys', label: 'Greys' },
          { value: 'rdylbu', label: 'Red–yellow–blue (diverging)' },
          { value: 'spectral', label: 'Spectral (diverging)' },
        ],
      },
    })
    .addTextInput({
      path: 'zarrRescale',
      name: 'Zarr value range',
      description:
        'Range a Zarr variable is stretched over, as min,max in the store’s own units — 0,30 for mm/day of rainfall, 270,305 for kelvin. Left empty, each tile is stretched over its own extremes and neighbouring tiles disagree about what a colour means. The colour ramp above is shared with rasters.',
      category: ['Map'],
      settings: { placeholder: '0,30' },
    })
    .addCustomEditor({
      id: 'variableMappings',
      path: 'variableMappings',
      name: '',
      description: 'Write a kepler filter into a dashboard variable to cross-filter other panels.',
      category: ['Cross-filtering'],
      editor: VariableSyncEditor,
    })
    .addCustomEditor({
      id: 'areaVariable',
      path: 'areaVariable',
      name: 'Publish drawn area',
      description: 'Write the polygon or rectangle drawn on the map to a dashboard variable as WKT.',
      category: ['Cross-filtering'],
      editor: AreaVariableEditor,
    })
    .addBooleanSwitch({
      path: 'clickArea',
      name: 'Click to set the area',
      description:
        'Clicking an entity on the map sets the drawn area to a square around it, as if drawn by hand. It shows on the map and deletes like a drawing.',
      category: ['Cross-filtering'],
      defaultValue: false,
      showIf: (config) => Boolean(config.areaVariable),
    })
    .addNumberInput({
      path: 'clickAreaSizeMetres',
      name: 'Square side (m)',
      description: 'Side of the square in metres; the same area at every latitude.',
      category: ['Cross-filtering'],
      defaultValue: DEFAULT_CLICK_AREA_METRES,
      settings: { min: 1, integer: true },
      showIf: (config) => Boolean(config.areaVariable) && Boolean(config.clickArea),
    })
    .addBooleanSwitch({
      path: 'clickConfirm',
      name: 'Select from the popup',
      description:
        'A click only shows the entity’s details; the popup’s Select button is what publishes, and Clear is what empties. For a map whose selection changes a tab or reloads data, so looking costs nothing.',
      category: ['Cross-filtering'],
      defaultValue: false,
      showIf: (config) =>
        (config.variableMappings ?? []).some((mapping) => mapping.source === 'click') ||
        (Boolean(config.areaVariable) && Boolean(config.clickArea)),
    })
    .addCustomEditor({
      id: 'adHocFilterFields',
      path: 'adHocFilterFields',
      name: 'Ad hoc filters from the popup',
      description:
        'Fields whose value the popup of a clicked entity adds to the dashboard’s ad hoc filters, for or out, as a table cell does.',
      category: ['Cross-filtering'],
      editor: AdHocFieldsEditor,
    })
    .addFieldNamePicker({
      path: 'selectionField',
      name: 'Highlight rows where',
      description:
        'A column of the query: the rows where it is true (or 1) are marked as selected, like a click, without the selection travelling in the URL.',
      category: ['Cross-filtering'],
    })
    .addBooleanSwitch({
      path: 'dimUnselected',
      name: 'Dim the rest',
      description:
        'While something is selected, cover every other row under a veil of the base map’s tone, so the selection stands out.',
      category: ['Cross-filtering'],
      defaultValue: false,
      showIf: (config) =>
        Boolean(config.selectionField) || (config.variableMappings ?? []).some((mapping) => mapping.source === 'click'),
    })
    .addRadio({
      path: 'haloStyle',
      name: 'Selection outline',
      description:
        'Auto: amber, or under Dim the rest a thin line for a few shapes and none for many. Amber reads on anything; a thin line stays legible; none leaves the selection to Dim the rest.',
      category: ['Cross-filtering'],
      defaultValue: 'auto',
      settings: {
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'amber', label: 'Amber' },
          { value: 'thin', label: 'Thin' },
          { value: 'none', label: 'None' },
        ],
      },
      showIf: (config) =>
        Boolean(config.selectionField) || (config.variableMappings ?? []).some((mapping) => mapping.source === 'click'),
    })
    .addCustomEditor({
      id: 'viewportVariables',
      path: 'viewportVariables',
      name: 'Publish viewport (for other panels)',
      description: 'Write the bounding box of what the map is showing to four dashboard variables.',
      category: ['Cross-filtering'],
      editor: ViewportVariablesEditor,
    })
    .addTextInput({
      path: 'mosaicSelection',
      name: 'Mosaic selection',
      description:
        'The name of a Mosaic Selection on this dashboard (Chaski app). The map’s range, time and multi-select filters filter the Mosaic and filters panels as you drag, and their brushes filter the map, column by column.',
      category: ['Cross-filtering'],
      settings: { placeholder: 'brush' },
    })
    .addTextInput({
      path: 'mosaicColumns',
      name: 'Mosaic location columns',
      description:
        'The longitude and latitude columns of the Selection’s data, as lng, lat: what the view and a drawn area filter there.',
      category: ['Cross-filtering'],
      settings: { placeholder: 'lng, lat' },
      showIf: (config) => Boolean(config.mosaicSelection?.trim()),
    })
    .addBooleanSwitch({
      path: 'mosaicArea',
      name: 'Filter by the drawn area',
      description: 'A polygon or rectangle drawn on the map keeps, in the Mosaic panels, the rows inside it.',
      category: ['Cross-filtering'],
      defaultValue: true,
      showIf: (config) => Boolean(config.mosaicSelection?.trim()) && Boolean(config.mosaicColumns?.trim()),
    })
    .addBooleanSwitch({
      path: 'mosaicViewport',
      name: 'Filter by the view',
      description: 'What the map shows filters the Mosaic panels as a bounding box while you pan and zoom.',
      category: ['Cross-filtering'],
      defaultValue: false,
      showIf: (config) => Boolean(config.mosaicSelection?.trim()) && Boolean(config.mosaicColumns?.trim()),
    })
    .addCustomEditor({
      id: 'fitOnVariables',
      path: 'fitOnVariables',
      name: 'Fit to data when these change',
      description: 'Frame the map on its rows again, as on load, when one of these variables changes.',
      category: ['Cross-filtering'],
      editor: FitVariablesEditor,
    })
    // "Map configuration" must stay the last category: saving the map is the
    // step that follows every other option, so it belongs where they end. Add
    // new options above this point.
    .addCustomEditor({
      id: 'saveRequest',
      path: 'saveRequest',
      name: 'Map configuration',
      description: 'Store the current layers, filters and base map with the dashboard.',
      category: ['Map configuration'],
      editor: SaveMapConfigEditor,
    })
    .addCustomEditor({
      id: 'mapConfig',
      path: 'mapConfig',
      name: 'Import configuration',
      description: 'Paste a config exported from kepler.gl, Foursquare Studio or Dekart.',
      category: ['Map configuration'],
      editor: MapConfigEditor,
    })
);

plugin.useFieldConfig({
  // The field options the map honours: data links and actions, offered in the
  // popup of a clicked entity (panel/dataLinks.ts, panel/mapActions.ts).
  // Grafana shows every standard option a panel does not disable, and the rest
  // (unit, colour, thresholds…) would sit in the editor doing nothing on a map
  // that colours its layers itself.
  disableStandardOptions: Object.values(FieldConfigProperty).filter(
    (p) => p !== FieldConfigProperty.Links && p !== FieldConfigProperty.Actions
  ),
  // Grafana keeps Actions out of a panel's defaults until the panel says it
  // runs them, and hides the "one click" switch of both until the panel says
  // it follows one; the map does both (panel/useDataLinks.ts).
  standardOptions: {
    [FieldConfigProperty.Links]: { settings: { showOneClick: true } },
    [FieldConfigProperty.Actions]: { hideFromDefaults: false, settings: { showOneClick: true } },
  },
});

// Grafana hands a panel the dashboard's annotations only when it asks for them:
// the map draws the ones with a place (see useGrafanaAnnotations).
plugin.setDataSupport({ annotations: true, alertStates: false });

// "Change visualization" from Geomap keeps its layers, view and base map.
plugin.setPanelChangeHandler((_panel, prevPluginId, prevOptions, prevFieldConfig) =>
  fromGeomapPanel(prevPluginId, prevOptions, prevFieldConfig, config.theme2)
);
