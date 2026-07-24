import { PanelPlugin } from '@grafana/data';

import { KeplerPanelOptions } from './types';
import { KeplerPanel } from './panel/KeplerPanel';
import { configureKepler } from './panel/keplerConfig';

// Must run before any kepler component mounts.
configureKepler();

export const plugin = new PanelPlugin<KeplerPanelOptions>(KeplerPanel);
