import { FieldRoleOverrides } from './data/detectFields';
import { FlowRenderMode } from './data/buildFlows';
import { TripLayerMode } from './data/buildTripLayer';
import { SavedMapConfig } from './data/mapConfig';
import { TimeSyncMode } from './panel/timeSync';
import { TimeVariableMapping } from './panel/timeVariableSync';
import { VariableMapping } from './panel/variableSync';

/** Built-in MapLibre base maps kepler ships, all served by Carto without a token. */
export type BasemapChoice = 'auto' | 'dark-matter' | 'positron' | 'voyager' | 'custom';

export interface KeplerPanelOptions {
  /**
   * Field mapping overrides, keyed by query refId. Anything absent falls back
   * to autodetection, so the panel works with no configuration at all; a role
   * set to `null` is switched off, which is how a trajectory query is drawn as
   * points rather than trips.
   */
  fieldMappings?: Record<string, FieldRoleOverrides>;

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
   * lets the map's time slider move the dashboard; `variables` publishes the
   * slider's window to a pair of dashboard variables instead of moving the
   * range; `off` decouples them.
   */
  timeSync?: TimeSyncMode;

  /**
   * The two dashboard variables the time slider's window is published to in
   * `variables` mode, as UTC ISO 8601 strings.
   *
   * Chosen over moving the dashboard time range because a range change re-runs
   * this panel's own query, and the rows that fall outside then leave the
   * browser — the histogram behind the slider rescales and the window cannot be
   * widened again from the map. Variables cost only the panels that reference
   * them, so the map keeps its whole dataset and the slider keeps its context.
   */
  timeVariables?: TimeVariableMapping;

  /**
   * Whether playing the time slider writes the window as it runs, rather than
   * only once it stops.
   *
   * Off by default because it is not free: a write propagates a variable change
   * through the whole dashboard, which re-runs the panels that read it and
   * costs the animation frames. Worth turning on when watching the numbers
   * move matters more than the playback being smooth.
   */
  publishWhilePlaying?: boolean;

  /**
   * Shares the map's clock — time filter and trip playhead — with the other
   * maps on the dashboard that also have this on, in the browser and without
   * moving the dashboard time range. Off by default: it couples panels, which
   * should be a deliberate choice.
   */
  peerTimeSync?: boolean;

  /** How auto-created flow layers draw their lines. Defaults to `straight`. */
  flowRenderMode?: FlowRenderMode;

  /**
   * How many wind streamlines to draw across a full screen, shared between the
   * velocity-field layers on it.
   *
   * There is no value that suits every map. A country covering a third of the
   * view wants more than a pair of three-kilometre patches around two weather
   * stations, and a field of parallel arrows reads as a solid block at a density
   * a swirling one reads well at, and zooming into a single station's patch
   * fills the screen with what was a comfortable count across a country.
   * Defaults to `9000`.
   */
  windDensity?: number;

  /**
   * Which of kepler's two Trip layer shapes a trajectory query loads as.
   * Defaults to `table`, which keeps one row per point and with it every column
   * the query returned.
   */
  tripLayerMode?: TripLayerMode;

  /**
   * Ties kepler filters to dashboard variables: setting a select/text filter on
   * the map writes its value to the named variable, cross-filtering the rest of
   * the dashboard.
   */
  variableMappings?: VariableMapping[];
}
