import { PanelPlugin } from '@grafana/data';

import { KeplerPanelOptions } from './types';
import { KeplerPanel } from './panel/KeplerPanel';
import { configureKepler } from './panel/keplerConfig';
import { SaveMapConfigEditor } from './editors/SaveMapConfigEditor';
import { MapConfigEditor } from './editors/MapConfigEditor';

// Must run before any kepler component mounts.
configureKepler();

export const plugin = new PanelPlugin<KeplerPanelOptions>(KeplerPanel).setPanelOptions((builder) =>
  builder
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
