import {
  addDataToMap,
  addLayer,
  createOrUpdateFilter,
  fitBounds,
  mapStyleChange,
  removeFilter,
  removeLayer,
  replaceDataInMap,
  setLayerAnimationTime,
  toggleSidePanel,
  updateVisData,
  wrapTo,
} from '@kepler.gl/actions';
import { processRowObject } from '@kepler.gl/processors';
import KeplerGlSchema from '@kepler.gl/schemas';
import type { Dispatch, Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import type { FlowLayerConfig } from '../data/buildFlows';
import type { TripLayerConfig } from '../data/buildTripLayer';
import type { SavedMapConfig } from '../data/mapConfig';
import type { MapStateLike } from './windViewport';
import {
  findTimeFieldName,
  readTimeFilterDomain,
  readTimeFilterValue,
  TIME_FILTER_TYPE,
  type TimeRangeMs,
} from './timeSync';
import { supersededTripLayerIds } from './autoLayers';
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

/**
 * Swaps the rows behind one dataset, keeping the layers built on it.
 *
 * `updateVisData` cannot do this. For an id it already knows, kepler takes the
 * "update the data when loading data by batches incrementally" path in
 * `createNewDataEntry`, which is meant for streaming a dataset in pieces — the
 * row count simply does not change. Verified against the store, not the panel's
 * label: after three zoom-out steps the dataset still reported every one of its
 * original rows.
 *
 * `replaceDataInMap` is kepler's own answer, and it preserves what matters:
 * internally it re-points the layers, filters and layer order at the new data
 * rather than dropping them, so this is not the removeDataset + addDataset that
 * costs the user their layer configuration.
 */
export function replaceDatasetData(dispatch: Dispatch, dataset: PanelDataset): void {
  const [keplerDataset] = toKeplerDatasets([dataset]);
  if (!keplerDataset) {
    return;
  }

  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      replaceDataInMap({
        datasetToReplaceId: dataset.id,
        datasetToUse: keplerDataset,
        // Re-framing on every pan would fight the gesture that triggered this.
        options: { centerMap: false, keepExistingConfig: true },
      })
    )
  );
}

/** Minimal view of the kepler vis-state these helpers read. */
interface VisStateLike {
  filters: Array<{
    id: string;
    type?: string;
    value?: unknown;
    name?: string[] | string;
    /** The data's own extent, which kepler keeps separate from `value`. */
    domain?: unknown;
    /** True while kepler is playing the filter window across the domain. */
    isAnimating?: boolean;
  }>;
  datasets: Record<string, { fields: Array<{ name: string; type?: string }> }>;
  layers: Array<{ id: string; type?: string; config?: { dataId?: string }; meta?: { bounds?: number[] } }>;
  animationConfig?: { currentTime?: number | null; domain?: number[] | null };
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

/**
 * The vis-state slices the sync hooks read, for deciding whether a store
 * notification is worth reacting to at all.
 *
 * Filters carry the time window and the cross-filter selections, datasets say
 * whether there is yet a time column to bind to, and the animation config holds
 * the trip playhead — between them that is everything the four sync hooks look
 * at. Panning the map, hovering a point and opening a panel touch none of the
 * three, so their identity stays put and the reconcile is skipped. See
 * {@link SliceWatcher}.
 */
export function readSyncSlices(store: Store): unknown[] {
  const visState = getVisState(store);
  return visState ? [visState.filters, visState.datasets, visState.animationConfig] : [];
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

/**
 * What the map is currently showing: centre, zoom and pixel size.
 *
 * Read raw rather than converted, so the Mercator arithmetic stays in a pure
 * module that can be tested without a store — see `windViewport.ts`.
 */
export function readMapState(store: Store): MapStateLike | null {
  const state = store.getState() as { keplerGl?: Record<string, { mapState?: MapStateLike }> };
  return state.keplerGl?.[KEPLER_INSTANCE_ID]?.mapState ?? null;
}

/** The map's current time-filter window, or null if it has no time filter. */
export function readTimeRange(store: Store): TimeRangeMs | null {
  const visState = getVisState(store);
  return visState ? readTimeFilterValue(visState.filters) : null;
}

/** The full time extent of the data behind the map's time filter. */
export function readTimeDomain(store: Store): TimeRangeMs | null {
  const visState = getVisState(store);
  return visState ? readTimeFilterDomain(visState.filters) : null;
}

/**
 * Whether kepler is currently playing the time filter across its domain.
 *
 * The play button moves the window roughly every frame, and each of those is a
 * fresh dashboard time range — which re-queries every panel and, worse, shrinks
 * the dataset the widget is animating over. So the time *range* sync always
 * sits the animation out and reports once it stops. The variable sync consults
 * this only when its panel is set to stay quiet during playback, which is the
 * default: publishing throughout is available, but it costs the animation
 * frames, so it is the user's call rather than the code's.
 */
export function isTimeFilterAnimating(store: Store): boolean {
  return Boolean(getVisState(store)?.filters.find((f) => f.type === TIME_FILTER_TYPE)?.isAnimating);
}

/**
 * Makes sure the map has a time filter, without narrowing anything.
 *
 * Creating the filter with no value leaves kepler to seed it with the data's
 * full domain, so the time widget appears showing the whole histogram with the
 * brush wide open — the state the dashboard time range already describes. That
 * is the point of variable mode: the window starts as context, not as a
 * restriction, and every drag from there is a real narrowing.
 *
 * Returns false when no dataset has a timestamp field to bind to, so the caller
 * can retry once data with a time column arrives.
 */
export function ensureTimeFilter(store: Store, dispatch: Dispatch): boolean {
  const visState = getVisState(store);
  if (!visState) {
    return false;
  }
  if (visState.filters.some((f) => f.type === TIME_FILTER_TYPE)) {
    return true;
  }

  for (const [dataId, dataset] of Object.entries(visState.datasets)) {
    const timeField = findTimeFieldName(dataset.fields);
    if (timeField) {
      dispatch(wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(undefined, dataId, timeField)));
      return true;
    }
  }
  return false;
}

/**
 * The trip animation playhead, or null when the map has no trip animation.
 *
 * This is kepler's second clock, and it is not the time filter: a Trip layer
 * plays along `animationConfig.currentTime` while filters have their own
 * window. A map can have either, both or neither.
 */
export function readAnimationTime(store: Store): number | null {
  const currentTime = getVisState(store)?.animationConfig?.currentTime;
  return typeof currentTime === 'number' ? currentTime : null;
}

/**
 * Moves the trip animation playhead.
 *
 * Returns false when the map has no animation to move — no trip layer, or one
 * whose domain kepler has not computed yet — so the caller can retry once the
 * data lands, the same way `pushTimeRange` does.
 */
export function pushAnimationTime(store: Store, dispatch: Dispatch, time: number): boolean {
  const domain = getVisState(store)?.animationConfig?.domain;
  if (!Array.isArray(domain) || domain.length < 2) {
    return false;
  }
  dispatch(wrapTo(KEPLER_INSTANCE_ID, setLayerAnimationTime(time)));
  return true;
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

/** Whether the map is ready for an auto-added layer to be added for `dataId`. */
export function autoLayerStatus(
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
 * Adds a layer kepler would not have created on its own, and returns the bounds
 * kepler computed for it, or null.
 *
 * kepler auto-creates default layers for points and geometry, but not for flows
 * (it has no detection for them at all) and not for the panel's trips (its
 * detection insists on a column named `id`). Both configs — from `buildFlows`
 * and `buildTripLayer` — are parsed by kepler because they carry
 * `visualChannels`. kepler computes the layer's data bounds while adding it,
 * synchronously, which the caller uses to frame the map on an OD dataset:
 * `addDataToMap` could not, having had no flow layer to measure.
 */
export function addAutoLayer(
  store: Store,
  dispatch: Dispatch,
  layer: FlowLayerConfig | TripLayerConfig,
  dataId: string
): MapBounds | null {
  dispatch(wrapTo(KEPLER_INSTANCE_ID, addLayer(layer, dataId)));

  // kepler may have guessed a Trip layer of its own for this dataset; ours,
  // built from the mapped trip id, replaces it.
  for (const id of supersededTripLayerIds(getVisState(store)?.layers ?? [], {
    id: layer.id,
    type: layer.type,
    dataId,
  })) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, removeLayer(id)));
  }

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
