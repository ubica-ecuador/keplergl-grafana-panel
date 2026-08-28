import { PanelPlugin } from '@grafana/data';

import { KeplerPanelOptions } from './types';
import { KeplerPanel } from './panel/KeplerPanel';
import { SaveMapConfigEditor } from './editors/SaveMapConfigEditor';
import { MapConfigEditor } from './editors/MapConfigEditor';
import { FieldMappingEditor } from './editors/FieldMappingEditor';
import { VariableSyncEditor } from './editors/VariableSyncEditor';
import { TimeVariableEditor } from './editors/TimeVariableEditor';
import { AreaVariableEditor } from './editors/AreaVariableEditor';
import { ViewportVariablesEditor } from './editors/ViewportVariablesEditor';
import { DEFAULT_RASTER_SERVER_URL } from './panel/constants';

export const plugin = new PanelPlugin<KeplerPanelOptions>(KeplerPanel).setPanelOptions((builder) =>
  builder
    .addTextInput({
      path: 'zarrRescale',
      name: 'Zarr value range',
      description:
        'Range a Zarr variable is stretched over, as min,max in the store\u2019s own units \u2014 0,30 for mm/day of rainfall, 270,305 for kelvin. Left empty, each tile is stretched over its own extremes and neighbouring tiles disagree about what a colour means. The ramp above is shared with rasters.',
      category: ['Map'],
      settings: { placeholder: '0,30' },
    })
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
    .addBooleanSwitch({
      path: 'peerTimeSync',
      name: 'Sync time with other maps',
      description:
        "Share this map's time filter and trip playhead with the other maps on the dashboard that have this on. Runs in the browser, so animating one map moves the rest without re-running any query.",
      category: ['Map'],
      defaultValue: false,
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
          { value: 'dark-matter', label: 'Dark Matter' },
          { value: 'positron', label: 'Positron' },
          { value: 'voyager', label: 'Voyager' },
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
      description: 'MapLibre style.json served from your own network — required for air-gapped installs.',
      category: ['Map'],
      settings: { placeholder: 'https://tiles.internal/style.json' },
      showIf: (config) => config.basemap === 'custom',
    })
    .addTextInput({
      path: 'rasterServerUrl',
      name: 'Raster tile server',
      description:
        'TiTiler-compatible server that turns a COG into tiles, for queries returning a raster_url column. It reads the imagery on the map\u2019s behalf, so it must be able to reach it \u2014 the public default cannot see anything private, and is given the url you point it at. A .pmtiles url needs no server and ignores this.',
      category: ['Map'],
      settings: { placeholder: DEFAULT_RASTER_SERVER_URL },
    })
    .addSelect({
      path: 'rasterColormap',
      name: 'Raster colour ramp',
      description:
        "Colour ramp for rasters a query produces. kepler's default is built for drone NDVI and steps through unrelated colours, which reads as noise on a continuous field.",
      category: ['Map'],
      defaultValue: '',
      settings: {
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
    .addCustomEditor({
      id: 'viewportVariables',
      path: 'viewportVariables',
      name: 'Publish viewport (for other panels)',
      description: "Write the bounding box of what the map is showing to four dashboard variables.",
      category: ['Cross-filtering'],
      editor: ViewportVariablesEditor,
    })
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
