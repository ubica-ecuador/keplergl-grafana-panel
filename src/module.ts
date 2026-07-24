import { PanelPlugin } from '@grafana/data';

import { KeplerPanelOptions } from './types';
import { KeplerPanel } from './panel/KeplerPanel';
import { SaveMapConfigEditor } from './editors/SaveMapConfigEditor';
import { MapConfigEditor } from './editors/MapConfigEditor';
import { FieldMappingEditor } from './editors/FieldMappingEditor';

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
          { value: 'off', label: 'Off' },
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
      description: 'Carto base maps, served without a Mapbox token.',
      category: ['Map'],
      defaultValue: 'auto',
      settings: {
        options: [
          { value: 'auto', label: 'Match theme' },
          { value: 'dark-matter', label: 'Dark Matter' },
          { value: 'positron', label: 'Positron' },
          { value: 'voyager', label: 'Voyager' },
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
