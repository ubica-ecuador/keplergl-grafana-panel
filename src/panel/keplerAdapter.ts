import {
  addDataToMap,
  addLayer,
  createOrUpdateFilter,
  fitBounds,
  mapStyleChange,
  removeFilter,
  toggleSidePanel,
  updateVisData,
  wrapTo,
} from '@kepler.gl/actions';
import { processRowObject } from '@kepler.gl/processors';
import KeplerGlSchema from '@kepler.gl/schemas';
import type { Dispatch, Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import type { FlowLayerConfig } from '../data/buildFlows';
import type { SavedMapConfig } from '../data/mapConfig';
import { findTimeFieldName, readTimeFilterValue, TIME_FILTER_TYPE, type TimeRangeMs } from './timeSync';
import { KEPLER_INSTANCE_ID } from './constants';

/**
 * The ONLY module that talks to the kepler.gl API.
 *
 * kepler.gl is pinned to a pre-release (3.3.0-alpha.3) because the Flow layer
 * exists nowhere else. Funnelling every kepler call through here means the
 * alpha -> stable upgrade touches one file instead of the whole tree.
 */

export type KeplerDataset = {
  info: { id: string; label: string };
  data: NonNullable<ReturnType<typeof processRowObject>>;
};

/**
 * Turns panel datasets into kepler datasets.
 *
 * `processRowObject` is what infers each column's type and analyzer, which is
 * how kepler decides what a column can be used for. Datasets it cannot process
 * (empty results, for instance) are dropped rather than passed on as null.
 */
export function toKeplerDatasets(datasets: PanelDataset[]): KeplerDataset[] {
  const out: KeplerDataset[] = [];
  for (const { id, label, rows } of datasets) {
    const data = processRowObject(rows);
    if (data) {
      out.push({ info: { id, label }, data });
    }
  }
  return out;
}

/**
 * First load: hands datasets and an optional saved config to kepler, letting it
 * create the default layers and frame the viewport around the data.
 */
export function loadDatasets(
  dispatch: Dispatch,
  datasets: PanelDataset[],
  options: { centerMap?: boolean } = {},
  savedConfig?: SavedMapConfig | null
): void {
  // parseSavedConfig returns null for a config it cannot migrate — for example
  // one exported by an older kepler. Falling back to no config beats refusing
  // to render the map at all.
  const config = savedConfig ? KeplerGlSchema.parseSavedConfig(savedConfig) : null;

  // A saved config already positions the map; re-framing it around the data
  // would throw away the viewport the user deliberately saved.
  const centerMap = options.centerMap ?? !config;

  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      addDataToMap({
        datasets: toKeplerDatasets(datasets),
        options: { centerMap },
        ...(config ? { config } : {}),
      })
    )
  );
}

/**
 * Snapshots the current map configuration — layers, filters, interactions, base
 * map — so it can be stored in the panel options.
 *
 * Returns null before kepler has registered its instance, which is what happens
 * if the user hits save on a panel whose map has not finished mounting.
 */
export function captureMapConfig(store: Store): SavedMapConfig | null {
  const state = store.getState() as { keplerGl?: Record<string, unknown> };
  const instance = state.keplerGl?.[KEPLER_INSTANCE_ID];
  if (!instance) {
    return null;
  }
  return KeplerGlSchema.getConfigToSave(instance) as unknown as SavedMapConfig;
}

/**
 * Refresh path: replaces the data behind existing datasets while preserving the
 * layers, filters and styling the user configured by hand.
 *
 * This is the deliberate departure from the Foursquare plugin, which does
 * removeDataset + addDataset on every refresh and therefore discards the user's
 * layer configuration each time the query re-runs.
 */
export function refreshDatasets(dispatch: Dispatch, datasets: PanelDataset[]): void {
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      updateVisData(toKeplerDatasets(datasets), {
        keepExistingConfig: true,
        // Re-framing the viewport on every refresh would fight the user panning.
        centerMap: false,
      })
    )
  );
}

/** Minimal view of the kepler vis-state these helpers read. */
interface VisStateLike {
  filters: Array<{ id: string; type?: string; value?: unknown; name?: string[] | string }>;
  datasets: Record<string, { fields: Array<{ name: string; type?: string }> }>;
  layers: Array<{ id: string; config?: { dataId?: string }; meta?: { bounds?: number[] } }>;
}

/** A kepler filter, as the variable sync reads it. */
export interface KeplerFilter {
  name?: string[] | string;
  type?: string;
  value?: unknown;
}

/** The map's current filters, for driving dashboard variables. */
export function readFilters(store: Store): KeplerFilter[] {
  return getVisState(store)?.filters ?? [];
}

function filterHasField(filter: { name?: string[] | string }, field: string): boolean {
  return Array.isArray(filter.name) ? filter.name.includes(field) : filter.name === field;
}

/**
 * Sets a multi-select filter on `field` to `values` (the variable → map
 * direction of cross-filtering).
 *
 * Updates the existing filter on that column if there is one, otherwise creates
 * one on the first dataset that has the column. A string column becomes a
 * multiSelect filter, so the values are applied as its selection.
 */
export function applyFieldFilter(store: Store, dispatch: Dispatch, field: string, values: string[]): void {
  const visState = getVisState(store);
  if (!visState) {
    return;
  }

  const existing = visState.filters.find((f) => filterHasField(f, field));
  if (existing) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(existing.id, undefined, undefined, values)));
    return;
  }

  for (const [dataId, dataset] of Object.entries(visState.datasets)) {
    if (dataset.fields.some((f) => f.name === field)) {
      dispatch(wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(undefined, dataId, field, values)));
      return;
    }
  }
}

/** Removes the filter on `field`, if any — clears a variable-driven selection. */
export function removeFieldFilter(store: Store, dispatch: Dispatch, field: string): void {
  const filters = getVisState(store)?.filters ?? [];
  const idx = filters.findIndex((f) => filterHasField(f, field));
  if (idx >= 0) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, removeFilter(idx)));
  }
}

/** A map bounding box in kepler's `[minLng, minLat, maxLng, maxLat]` order. */
export type MapBounds = [number, number, number, number];

function getVisState(store: Store): VisStateLike | null {
  const state = store.getState() as { keplerGl?: Record<string, { visState?: VisStateLike }> };
  return state.keplerGl?.[KEPLER_INSTANCE_ID]?.visState ?? null;
}

/** The map's current time-filter window, or null if it has no time filter. */
export function readTimeRange(store: Store): TimeRangeMs | null {
  const visState = getVisState(store);
  return visState ? readTimeFilterValue(visState.filters) : null;
}

/**
 * Reflects a Grafana time range on the map's time filter.
 *
 * Updates the existing time filter when there is one, otherwise creates one on
 * the first dataset that has a timestamp field. kepler clamps the window to the
 * data's own time domain. Returns false — a no-op — when no dataset has a time
 * field to filter on, e.g. a pure geometry or trip map, which lets the caller
 * retry once data with a time column arrives.
 */
export function pushTimeRange(store: Store, dispatch: Dispatch, range: TimeRangeMs): boolean {
  const visState = getVisState(store);
  if (!visState) {
    return false;
  }

  const value: [number, number] = [range.from, range.to];

  const existing = visState.filters.find((f) => f.type === TIME_FILTER_TYPE);
  if (existing) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(existing.id, undefined, undefined, value)));
    return true;
  }

  for (const [dataId, dataset] of Object.entries(visState.datasets)) {
    const timeField = findTimeFieldName(dataset.fields);
    if (timeField) {
      dispatch(wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(undefined, dataId, timeField, value)));
      return true;
    }
  }

  return false;
}

/** Whether the map is ready for a flow layer to be added for `dataId`. */
export function flowLayerStatus(
  store: Store,
  dataId: string,
  layerId: string
): { datasetLoaded: boolean; layerExists: boolean } {
  const visState = getVisState(store);
  if (!visState) {
    return { datasetLoaded: false, layerExists: false };
  }
  return {
    datasetLoaded: Boolean(visState.datasets[dataId]),
    layerExists: (visState.layers ?? []).some((l) => l.id === layerId),
  };
}

/**
 * Adds a flow layer for an origin-destination dataset and returns the bounds
 * kepler computed for it, or null.
 *
 * kepler auto-creates default layers for points, geometry and trips but not for
 * flows, so an OD dataset would otherwise render nothing. The layer config comes
 * from `buildFlows`; kepler parses it because it carries `visualChannels`. kepler
 * computes the layer's data bounds while adding it (synchronously), which the
 * caller uses to frame the map — `addDataToMap` could not, having had no flow
 * layer to measure.
 */
export function addFlowLayer(
  store: Store,
  dispatch: Dispatch,
  layer: FlowLayerConfig,
  dataId: string
): MapBounds | null {
  dispatch(wrapTo(KEPLER_INSTANCE_ID, addLayer(layer, dataId)));

  const added = getVisState(store)?.layers.find((l) => l.id === layer.id);
  const bounds = added?.meta?.bounds;
  return Array.isArray(bounds) && bounds.length === 4 ? (bounds as MapBounds) : null;
}

/** Frames the map on a bounding box. */
export function fitMapToBounds(dispatch: Dispatch, bounds: MapBounds): void {
  dispatch(wrapTo(KEPLER_INSTANCE_ID, fitBounds(bounds)));
}

/** Switches the base map to one of kepler's registered styles. */
export function setBasemap(dispatch: Dispatch, styleId: string): void {
  dispatch(wrapTo(KEPLER_INSTANCE_ID, mapStyleChange(styleId)));
}

/**
 * Shows or hides kepler's layer/filter side panel.
 *
 * kepler models this as "which panel is open", so hiding means selecting no
 * panel at all rather than a visibility flag.
 */
export function setSidePanel(dispatch: Dispatch, visible: boolean): void {
  dispatch(wrapTo(KEPLER_INSTANCE_ID, toggleSidePanel(visible ? 'layer' : null)));
}
