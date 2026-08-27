import { DataFrame } from '@grafana/data';

import { buildFlowField, FlowFieldLayerConfig } from './buildFlowField';
import { buildFlows, FlowLayerConfig, FlowRenderMode } from './buildFlows';
import { buildTripLayer, TripLayerConfig, TripLayerMode } from './buildTripLayer';
import { buildTrips } from './buildTrips';
import { earliestTimestepRows } from './buildWindField';
import { detectFields, FieldRoleOverrides, FieldRoles, resolveRoles } from './detectFields';
import { KeplerRow, toKeplerRows } from './toKeplerDataset';

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
   * A flow field layer to add, when the query is a grid of velocities.
   *
   * kepler has no detection for one — and could not have, since what is drawn
   * exists nowhere in the rows — so the panel adds it explicitly, the way it
   * does for flows and trips.
   */
  flowFieldLayer?: FlowFieldLayerConfig;
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
    // came, and the flow field layer traces the paths through them. What it does
    // not keep is the rest of the forecast — see `oneTimestep`.
    if (isWindFrame(roles)) {
      return {
        id,
        label,
        rows: oneTimestep(frame, roles),
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
 * The rows of one timestep — the earliest the query returned.
 *
 * A velocity query normally returns every hour of a forecast, so the same cell
 * appears many times. Keeping them all would let whichever row came last
 * overwrite each cell, which for a reversing wind means drawing the opposite of
 * the truth.
 *
 * The time column is dropped along with the other hours, and that is the point
 * of doing this here rather than in the layer. A grid that reached kepler with a
 * timestamp would grow a time filter over rows nobody filters — the layer reads
 * the whole dataset — leaving a widget on the map that moves and changes
 * nothing.
 */
function oneTimestep(frame: DataFrame, roles: FieldRoles): KeplerRow[] {
  const indices = earliestTimestepRows(frame, roles.time);
  const withoutTime = { ...frame, fields: frame.fields.filter((field) => field.name !== roles.time) };
  return toKeplerRows(withoutTime, { ...roles, time: undefined }, indices);
}

export function datasetId(refId: string): string {
  return `grafana-${refId}`;
}
