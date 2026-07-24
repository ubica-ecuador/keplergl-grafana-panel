import { FieldRoles } from './data/detectFields';
import { SavedMapConfig } from './data/mapConfig';
import { TimeSyncMode } from './panel/timeSync';

/** Built-in MapLibre base maps kepler ships, all served by Carto without a token. */
export type BasemapChoice = 'auto' | 'dark-matter' | 'positron' | 'voyager' | 'custom';

export interface KeplerPanelOptions {
  /**
   * Field mapping overrides, keyed by query refId. Anything absent falls back
   * to autodetection, so the panel works with no configuration at all.
   */
  fieldMappings?: Record<string, FieldRoles>;

  /**
   * The saved map configuration: layers, filters, interactions, base map.
   * Written by the panel when the user asks for a save, and applied on load.
   */
  mapConfig?: SavedMapConfig | null;

  /**
   * Save request counter.
   *
   * Grafana gives panel option editors no channel to the panel component, and
   * the map state lives in the panel's Redux store — so the editor bumps this
   * counter and the panel, which can see its own store, does the capture. A
   * counter rather than a boolean so repeated saves always register.
   */
  saveRequest?: number;

  /** kepler's layer/filter side panel. Worth hiding on small dashboard tiles. */
  showSidePanel?: boolean;

  /** `auto` follows the Grafana theme: dark-matter in dark mode, positron in light. */
  basemap?: BasemapChoice;

  /**
   * A self-hosted MapLibre `style.json`. The Carto base maps need outbound
   * internet, which air-gapped Grafana installs do not have.
   */
  customBasemapUrl?: string;

  /** Follow the dashboard theme. Off leaves kepler with its own dark styling. */
  followGrafanaTheme?: boolean;

  /**
   * Couples the dashboard time range with the map's time filter. `toMap` (the
   * default) drives the map from the dashboard one way; `bidirectional` also
   * lets the map's time slider move the dashboard; `off` decouples them.
   */
  timeSync?: TimeSyncMode;
}
