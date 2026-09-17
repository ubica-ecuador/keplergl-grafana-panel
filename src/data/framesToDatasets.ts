import { DataFrame, FieldType } from '@grafana/data';

import { buildFlowField, FlowFieldLayerConfig } from './buildFlowField';
import { buildFlows, FlowLayerConfig, FlowRenderMode } from './buildFlows';
import { buildSymbolLayer, SymbolLayerConfig } from './buildSymbolLayer';
import { buildTripLayer, TripLayerConfig, TripLayerMode } from './buildTripLayer';
import { buildTrips } from './buildTrips';
import { describesLattice, earliestTimestepRows } from './buildWindField';
import { detectFields, FieldRoleOverrides, FieldRoles, resolveRoles } from './detectFields';
import { KeplerColumn, KeplerRow, toKeplerColumns, toKeplerRows } from './toKeplerDataset';

/** One kepler dataset per Grafana query. */
export interface PanelDataset {
  id: string;
  label: string;
  rows: KeplerRow[];
  /**
   * The query's columns, when it returned no rows. An empty result is ordinary —
   * a query waiting on a variable nobody has set yet — and a saved layer on it
   * needs its columns to exist: without them kepler parks the layer as pending,
   * and saving the map configuration then drops it.
   */
  columns?: KeplerColumn[];
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
   * A flow field layer to add, when the query is a grid of velocities.
   *
   * kepler has no detection for one — and could not have, since what is drawn
   * exists nowhere in the rows — so the panel adds it explicitly, the way it
   * does for flows and trips.
   */
  flowFieldLayer?: FlowFieldLayerConfig;
  /**
   * A symbol layer to add, when the query is a scattering of points that carry
   * a bearing — weather stations, vessels, aircraft.
   *
   * The counterpart of `flowFieldLayer`, and the reason the wind test now asks
   * whether the rows form a lattice: without that question a station query
   * built a flow field that drew nothing and explained nothing.
   */
  symbolLayer?: SymbolLayerConfig;
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
  } = {}
): PanelDataset[] {
  const resolved = frames.map((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    return { frame, refId, roles: resolveRoles(detectFields(frame), overrides[refId]) };
  });

  return resolved.map(({ frame, refId, roles }) => {
    const id = datasetId(refId);
    const label = frame.name ?? `Query ${refId}`;

    // A velocity grid stays a velocity grid: the rows travel to kepler as they
    // came, every hour of the forecast among them. kepler's time filter is what
    // walks them, and the layer draws the latest hour inside its window — see
    // `latestStepRows`. Keeping only the first hour was the workaround for a
    // map whose clock was already spent on the animation's phase.
    if (isWindFrame(roles) && isLatticeFrame(frame, roles)) {
      return {
        id,
        label,
        rows: toKeplerRows(frame, roles),
        flowFieldLayer: buildFlowField(roles, id) ?? undefined,
      };
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
    const rows = toKeplerRows(frame, roles);
    const symbolRoles = withNumericBearings(frame, roles);
    return {
      id,
      label,
      rows,
      columns: rows.length === 0 ? toKeplerColumns(frame, roles) : undefined,
      tripLayer: buildTripLayer(roles, id) ?? undefined,
      flowLayer: buildFlows(roles, id, { renderingMode: opts.flowRenderMode }) ?? undefined,
      symbolLayer: pointsSymbols(symbolRoles) ? (buildSymbolLayer(symbolRoles, id) ?? undefined) : undefined,
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

/**
 * Whether the rows of a velocity query sit on a regular lattice.
 *
 * A grid is a field and is drawn as one; a scattering of stations is not, and
 * pretending otherwise draws nothing at all.
 */
function isLatticeFrame(frame: DataFrame, roles: FieldRoles): boolean {
  const indices = earliestTimestepRows(frame, roles.time);
  const values = (name?: string) => {
    const field = name ? frame.fields.find((f) => f.name === name) : undefined;
    return field ? indices.map((i) => Number(field.values[i])) : [];
  };
  return describesLattice(values(roles.latitude), values(roles.longitude));
}

/**
 * Whether a tabular query describes symbols: points with something that points.
 *
 * A trip id disqualifies it for the same reason it disqualifies a velocity
 * field — a trajectory is a path, not a scattering of marks.
 */
function pointsSymbols(roles: FieldRoles): boolean {
  const bearing = Boolean(roles.rotation || roles.direction);
  return Boolean(roles.latitude && roles.longitude && bearing && !roles.tripId);
}

/**
 * The roles with a bearing kept only where its column holds numbers.
 *
 * Detection goes by name, and `track`, `course`, `heading` or `direction` are
 * as likely to name a label or a url as a number of degrees. A symbol layer
 * built on one of those is worse than none: kepler drops a rotation channel
 * whose column is not numeric, and the symbol layer has already taken the place
 * of the Point layer kepler guessed. A text bearing is set aside rather than
 * disqualifying the query, so a numeric wind direction beside it still turns
 * the symbols.
 */
function withNumericBearings(frame: DataFrame, roles: FieldRoles): FieldRoles {
  const numeric = (name?: string) =>
    Boolean(name) && frame.fields.some((field) => field.name === name && field.type === FieldType.number);
  return {
    ...roles,
    rotation: numeric(roles.rotation) ? roles.rotation : undefined,
    direction: numeric(roles.direction) ? roles.direction : undefined,
  };
}

export function datasetId(refId: string): string {
  return `grafana-${refId}`;
}
