import { PanelPlugin } from '@grafana/data';

import { KeplerPanelOptions } from './types';
import { KeplerPanel } from './panel/KeplerPanel';
import { SaveMapConfigEditor } from './editors/SaveMapConfigEditor';
import { MapConfigEditor } from './editors/MapConfigEditor';
import { FieldMappingEditor } from './editors/FieldMappingEditor';
import { VariableSyncEditor } from './editors/VariableSyncEditor';
import { TimeVariableEditor } from './editors/TimeVariableEditor';

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
    .addSliderInput({
      path: 'windDensity',
      name: 'Wind line density',
      description:
        'Streamlines drawn across a full screen, shared between the velocity-field layers on it. Lower it when a field looks like a solid block; raise it when it looks sparse.',
      category: ['Map'],
      defaultValue: 9000,
      settings: { min: 500, max: 20000, step: 500 },
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
    .addCustomEditor({
      id: 'variableMappings',
      path: 'variableMappings',
      name: '',
      description: 'Write a kepler filter into a dashboard variable to cross-filter other panels.',
      category: ['Cross-filtering'],
      editor: VariableSyncEditor,
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
