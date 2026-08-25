import { FieldRoleOverrides } from './data/detectFields';
import { FlowRenderMode } from './data/buildFlows';
import { TripLayerMode } from './data/buildTripLayer';
import { SavedMapConfig } from './data/mapConfig';
import { TimeSyncMode } from './panel/timeSync';
import { TimeVariableMapping } from './panel/timeVariableSync';
import { VariableMapping } from './panel/variableSync';
import { ViewportVariables } from './panel/viewportSync';

/**
 * Base maps offered in the panel options.
 *
 * All of them work without a Mapbox token: the first four are kepler's MapLibre
 * styles served by Carto, and `grafana-satellite` is the plugin's own Esri
 * imagery style. The value is the kepler style id, so `KeplerPanel` can pass it
 * straight through.
 */
export type BasemapChoice =
  | 'auto'
  | 'dark-matter'
  | 'positron'
  | 'voyager'
  | 'grafana-satellite'
  | 'grafana-satellite-terrain'
  | 'grafana-topographic-terrain'
  | 'custom';

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

  /**
   * Colour ramp for rasters the queries produce.
   *
   * kepler's own default is `cfastie`, which is built for drone NDVI and is not
   * monotonic — it steps through black, grey, white, green, yellow, red and
   * magenta. On a continuous field like rainfall or temperature, neighbouring
   * cells of similar value land on unrelated colours and the map reads as
   * confetti. Left empty, nothing is imposed and kepler's default stands.
   */
  rasterColormap?: string;

  /**
   * Base URL of the TiTiler-compatible server that turns a COG into tiles, for
   * queries that return a link to imagery rather than rows.
   *
   * There is no useful public default. A tile server reads the raster on the
   * panel's behalf, so it is the one piece that has to be able to reach the
   * imagery: private rasters are exactly what a public service cannot serve.
   * Left empty, the panel falls back to the server in this repository's
   * docker-compose, which is right for development and wrong everywhere else.
   */
  rasterServerUrl?: string;

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
   * the dashboard. A mapping with `source: 'click'` publishes the clicked
   * entity's value of the column instead — one way, map to variable — so
   * clicking a vehicle on the map filters the dashboard to that vehicle. One
   * with `source: 'coordinate'` publishes the clicked place as a lat/lng
   * variable pair, for the other panels' spatial queries.
   */
  variableMappings?: VariableMapping[];

  /**
   * Dashboard variables the map's viewport is published to, as the four edges
   * of its bounding box in EPSG:4326 — `lng BETWEEN $west AND $east` on the
   * consuming side.
   *
   * One way, and for the *other* panels: putting the bbox in this panel's own
   * query shrinks its data to what is on screen, after which zooming out
   * cannot bring those rows back. Published when the map comes to rest, and
   * once on load so a consumer never opens without a value.
   */
  viewportVariables?: ViewportVariables;

  /**
   * Dashboard variable the figure drawn on the map is published to, as WKT in
   * EPSG:4326 — `ST_GeomFromText($area, 4326)` on the consuming side.
   *
   * One way only, and only the most recent figure; deleting the last one
   * clears the variable to ''. Never written on dashboard load, so the value a
   * shared link carries survives. The variable is for the *other* panels'
   * queries: put it in this panel's own and drawing a shape shrinks the map's
   * dataset, after which the shape can never be widened again from the map.
   */
  areaVariable?: string;
}
