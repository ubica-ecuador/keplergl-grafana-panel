import { DataFrame } from '@grafana/data';

import { buildFlows, FlowLayerConfig, FlowRenderMode } from './buildFlows';
import { buildTripLayer, TripLayerConfig, TripLayerMode } from './buildTripLayer';
import { buildTrips } from './buildTrips';
import { buildWindField, smoothWindField, WindField } from './buildWindField';
import { detectFields, FieldRoleOverrides, FieldRoles, resolveRoles } from './detectFields';
import { KeplerRow, toKeplerRows } from './toKeplerDataset';
import { traceStreamlines, Viewport } from './traceStreamlines';

/** One kepler dataset per Grafana query. */
export interface PanelDataset {
  id: string;
  label: string;
  rows: KeplerRow[];
  /**
   * A flow layer to add for this dataset, when the query is origin-destination.
   * kepler does not auto-detect flow layers, so the panel adds it explicitly.
   */
  flowLayer?: FlowLayerConfig;
  /**
   * A trip layer to add for this dataset, when the query is a trajectory.
   * kepler's own trip detection only fires on a column named `id`, so this is
   * added explicitly too.
   */
  tripLayer?: TripLayerConfig;
  /**
   * Present when the query described a velocity field.
   *
   * Carrying the field itself lets the viewport re-trace the streamlines without
   * the DataFrame: the view changes far more often than the query runs, and
   * rebuilding from the frame each time would tie redraws to Grafana's query
   * lifecycle. `baseMs` travels with it so re-tracing does not shift the
   * animation clock under the playhead.
   */
  wind?: { field: WindField; baseMs: number; share: number; rawAltitudeMeters: number };
}

/**
 * Turns a panel's query results into one kepler dataset per query.
 *
 * The dataset id is derived from the query's refId so it is stable across
 * refreshes — that stability is what lets `updateVisData` replace the data
 * behind a dataset while keeping the layers the user configured on top of it.
 *
 * `overrides` carries the panel's saved field mapping, keyed by refId; anything
 * not overridden falls back to autodetection, and a role set to `null` is off.
 */
export function framesToDatasets(
  frames: DataFrame[],
  overrides: Record<string, FieldRoleOverrides> = {},
  opts: {
    flowRenderMode?: FlowRenderMode;
    tripLayerMode?: TripLayerMode;
    /** Epoch ms the wind animation starts from; defaults to now. */
    windBaseMs?: number;
    /** What the map is showing, so the streamlines follow the screen. */
    viewport?: Viewport;
  } = {}
): PanelDataset[] {
  const resolved = frames.map((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    return { frame, refId, roles: resolveRoles(detectFields(frame), overrides[refId]) };
  });

  // The line count is a budget for the screen, not for each query. Three levels
  // each drawing a full allowance put three times Esri's entire line count into
  // the same pixels, and the levels stop being tellable apart.
  const windFrames = resolved.filter((r) => isWindFrame(r.roles));
  const windLayers = windFrames.length;

  // One exaggeration for the whole stack, derived from the view rather than
  // fixed. A factor that separates pressure levels nicely over a country puts
  // the top one off the screen over a city, and one that works over a city
  // flattens the stack over a country. Tying it to the viewport keeps the stack
  // at the same share of the view wherever the user is looking, and using a
  // single factor keeps the levels in their real proportion to each other.
  const exaggeration = verticalExaggeration(
    windFrames.map(({ frame, roles }) => constantOf(frame, roles.altitude)),
    opts.viewport
  );

  return resolved.map(({ frame, refId, roles }) => {
    const id = datasetId(refId);
    const label = frame.name ?? `Query ${refId}`;

    // A velocity field is not a table of places: the rows describe a grid, and
    // what gets drawn are the paths traced through it. kepler then detects the
    // Trip layer from `_geojson` by itself, so no layer config rides along.
    if (isWindFrame(roles)) {
      const raw = buildWindField(frame, windColumns(roles));
      // Smoothed once here, not on every re-trace: the field does not change
      // when the view does, and blurring is the expensive part.
      const field = raw ? smoothWindField(raw, WIND_SMOOTHING_CELLS) : null;
      const baseMs = opts.windBaseMs ?? Date.now();
      const share = Math.max(1, windLayers);
      // The tracer produces its own geometry, so the altitude role has to be
      // handed to it as a value. Left out, every level sits on the ground and
      // stacking them reads as one flat layer.
      const rawAltitudeMeters = constantOf(frame, roles.altitude);
      return field
        ? {
            id,
            label,
            rows: traceWind(field, baseMs, opts.viewport, share, rawAltitudeMeters * exaggeration),
            wind: { field, baseMs, share, rawAltitudeMeters },
          }
        : { id, label, rows: [] };
    }

    // The compact shape for trajectories: one row per trip carrying the path.
    // kepler detects the `_geojson` column and builds the layer itself, so none
    // is supplied here — and nothing else survives the fold, which is the
    // trade the user is making by choosing this mode.
    if (opts.tripLayerMode === 'geojson' && isTripFrame(roles)) {
      return { id, label, rows: buildTrips(frame, roles) };
    }

    // Otherwise the query stays tabular — one row in, one row out. What varies
    // is the layers that ride along: kepler auto-detects points and geometry
    // but neither trips (its heuristic wants a column named `id`) nor flows, so
    // the panel supplies those two itself.
    return {
      id,
      label,
      rows: toKeplerRows(frame, roles),
      tripLayer: buildTripLayer(roles, id) ?? undefined,
      flowLayer: buildFlows(roles, id, { renderingMode: opts.flowRenderMode }) ?? undefined,
    };
  });
}

/**
 * A query describes trips when it has an id to group by, a time to order by and
 * point coordinates to trace — the three things `buildTrips` needs to fold many
 * GPS pings into one path.
 */
function isTripFrame(roles: FieldRoles): boolean {
  return Boolean(roles.tripId && roles.time && roles.latitude && roles.longitude);
}

/**
 * Blur radius in cells, matching the `smoothing: 3` Esri uses.
 *
 * At 0.25° a cell is ~28 km, so this averages over roughly a synoptic feature —
 * enough to stop the tracer jittering between adjacent cells without erasing
 * anything a 25 km model actually resolves.
 */
const WIND_SMOOTHING_CELLS = 3;

/**
 * How much of the view's width the top of a stack of levels should rise to.
 *
 * Below about a tenth the levels sit on top of each other; much above a fifth
 * the stack stops reading as a map and starts reading as a wall.
 */
const STACK_SHARE_OF_VIEW = 0.15;

const METRES_PER_DEGREE = 111_320;

/**
 * How the streamlines are drawn when nothing says otherwise.
 *
 * The stagger is not cosmetic. kepler has one clock per layer, so a trip is only
 * drawn during its own interval; without spreading the starts, every streamline
 * would appear and vanish together — a heartbeat rather than a flow.
 */
const WIND_DEFAULTS = {
  /**
   * Lines per *full* screen, shared between the wind layers on it — the same
   * budget Esri's demo spends. Only the share the data actually covers is drawn.
   *
   * Split three ways for three pressure levels this is 3000 each. Esri's own
   * demo spends 6000 on a single field, so this is generous — deliberately, on
   * the evidence: at 2000 per level the field read as sparse.
   */
  count: 9000,
  seed: 1,
  /**
   * One shared window for every streamline, so the whole field is on screen at
   * all times and what moves is a short trail — the earth.nullschool look.
   *
   * The alternative, staggering short-lived lines, leaves only a fraction alive
   * at any instant: scattered gaps rather than flow. Pair this with a short
   * `Trail Length` on the layer; the longer the trail, the closer it gets to
   * drawing whole streamlines at once.
   */
  cycleMs: 60_000,
};

/**
 * A query describes a velocity field when it has coordinates and a velocity —
 * as components or as speed plus meteorological direction.
 *
 * The trip id is disqualifying: a GPS trace carrying a `speed` column is a
 * trajectory, not a field, and shredding it into streamlines would produce
 * lines that mean nothing.
 */
function isWindFrame(roles: FieldRoles): boolean {
  const hasComponents = Boolean(roles.u && roles.v);
  const hasPolar = Boolean(roles.speed && roles.direction);
  return Boolean(roles.latitude && roles.longitude && (hasComponents || hasPolar) && !roles.tripId);
}

function windColumns(roles: FieldRoles) {
  return {
    latitude: roles.latitude!,
    longitude: roles.longitude!,
    u: roles.u,
    v: roles.v,
    speed: roles.speed,
    direction: roles.direction,
    time: roles.time,
  };
}

/**
 * Traces the streamlines for a field, optionally following the current view.
 *
 * Exported because the viewport hook calls it again on every settle, with the
 * same field and clock but a new extent. Keeping it here keeps the defaults in
 * one place: two callers drifting apart would show different line densities
 * before and after the first pan.
 */
export function traceWind(
  field: WindField,
  baseMs: number,
  viewport?: Viewport,
  share = 1,
  altitudeMeters = 0
): KeplerRow[] {
  return traceStreamlines(field, {
    ...WIND_DEFAULTS,
    count: Math.round(WIND_DEFAULTS.count / share),
    baseMs,
    viewport,
    altitudeMeters,
  });
}

/**
 * How much to stretch the vertical so a stack of levels reads on screen.
 *
 * Pressure levels a few kilometres apart are invisible over a country hundreds
 * of kilometres wide — 1000 to 700 hPa is 2.9 km over ~650 km, four parts in a
 * thousand — and a camera tilt compresses the vertical further still. The stack
 * is scaled to a share of the view instead, which is the only way one number can
 * serve every zoom.
 *
 * Returns 1 with no viewport or no heights, so nothing is invented when there is
 * nothing to stack.
 */
function verticalExaggeration(altitudes: number[], viewport?: Viewport): number {
  return stackExaggeration(Math.max(0, ...altitudes), viewport);
}

/** The same factor, for the viewport hook to recompute on every re-trace. */
export function stackExaggeration(tallest: number, viewport?: Viewport): number {
  if (!viewport || tallest <= 0) {
    return 1;
  }

  const metresAcross =
    (viewport.east - viewport.west) *
    METRES_PER_DEGREE *
    Math.cos((((viewport.south + viewport.north) / 2) * Math.PI) / 180);

  return (metresAcross * STACK_SHARE_OF_VIEW) / tallest;
}

/**
 * The value of a column that is the same for every row — the shape a level's
 * height takes in a wind query, where one query is one pressure level.
 */
function constantOf(frame: DataFrame, column?: string): number {
  const field = column ? frame.fields.find((f) => f.name === column) : undefined;
  if (!field) {
    return 0;
  }
  for (let i = 0; i < frame.length; i++) {
    const value = Number(field.values[i]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

export function datasetId(refId: string): string {
  return `grafana-${refId}`;
}
