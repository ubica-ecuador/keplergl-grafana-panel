import { FlyToInterpolator } from '@deck.gl/core';
import {
  addLayer,
  interactionConfigChange,
  layerConfigChange,
  layerVisConfigChange,
  layerVisualChannelConfigChange,
  mapStyleChange,
  receiveMapConfig,
  removeLayer,
  updateMap,
  wrapTo,
} from '@kepler.gl/actions';
import KeplerGlSchema from '@kepler.gl/schemas';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { KEPLER_INSTANCE_ID } from '../panel/constants';
import {
  applyAreaFilter,
  applyFieldFilter,
  applyRangeFilter,
  drawArea,
  fitMapToBounds,
  readDrawnAreas,
  readFigures,
  readFilters,
  removeFieldFilter,
  removeFigure,
} from '../panel/keplerAdapter';
import type { LayerChange, MapActions, TableView, UndoResult } from './askMapTools';
import { buildLayerConfig, colorScaleFor, heightsFor, sizeChannel, visConfigFor, type LayerType } from './keplerLayers';

interface DatasetLike {
  id?: string;
  label?: string;
  type?: string;
  fields?: Array<{ name: string; type?: string; fieldIdx?: number }>;
  dataContainer?: { numRows(): number; valueAt(row: number, col: number): unknown };
}

interface LayerLike {
  config?: { dataId?: string; columns?: Record<string, { value?: string | null } | undefined> };
}

interface LiveLayer {
  id: string;
  type?: string;
  config?: {
    label?: string;
    dataId?: string;
    isVisible?: boolean;
    colorField?: { name: string } | null;
    sizeField?: { name: string } | null;
    weightField?: { name: string } | null;
    visConfig?: Record<string, unknown>;
  };
  meta?: { bounds?: number[] };
}

interface ZoomOpacityController {
  id: string;
  layerIds: string[];
  stops: { appear: number; full: number; fade: number; gone: number };
}

interface KeplerInstance {
  visState?: {
    datasets?: Record<string, DatasetLike>;
    layers?: LiveLayer[];
    interactionConfig?: { zoomOpacity?: { enabled?: boolean; config?: { controllers?: ZoomOpacityController[] } } };
  };
  mapState?: { pitch?: number; bearing?: number; zoom?: number };
  mapStyle?: { styleType?: string; mapStyles?: Record<string, { label?: string }> };
}

function instance(store: Store): KeplerInstance | undefined {
  return (store.getState() as { keplerGl?: Record<string, KeplerInstance> }).keplerGl?.[KEPLER_INSTANCE_ID];
}

/** Layers this assistant added, per map: the only ones it may remove. */
const addedLayers = new WeakMap<Store, Set<string>>();

function findLayer(store: Store, ref: string): LiveLayer | undefined {
  const layers = instance(store)?.visState?.layers ?? [];
  const wanted = ref.trim().toLowerCase();
  return layers.find((l) => l.id === ref) ?? layers.find((l) => (l.config?.label ?? '').toLowerCase() === wanted);
}

/** The map's layers, base map and camera, for the system prompt (read fresh each round). */
export function describeMap(store: Store): string {
  const kepler = instance(store);
  const layers = (kepler?.visState?.layers ?? []).map((l) => {
    const c = l.config ?? {};
    const vc = c.visConfig ?? {};
    const parts = [
      `id ${l.id}`,
      `"${c.label ?? ''}"`,
      l.type,
      `dataset ${c.dataId}`,
      c.isVisible === false ? 'hidden' : 'visible',
      c.colorField ? `colour by ${c.colorField.name}` : '',
      c.sizeField ? `size by ${c.sizeField.name}` : '',
      c.weightField ? `weight by ${c.weightField.name}` : '',
      vc.enable3d || vc.surfaceEnabled ? '3D' : '',
      addedLayers.get(store)?.has(l.id) ? 'added by you' : '',
    ];
    return `- ${parts.filter(Boolean).join(', ')}`;
  });
  const styles = Object.keys(kepler?.mapStyle?.mapStyles ?? {});
  return [
    'Layers (top first):',
    layers.length ? layers.join('\n') : '- none',
    `Base map: ${kepler?.mapStyle?.styleType ?? 'unknown'}. Available: ${styles.join(', ') || 'none'}.`,
    `Camera: pitch ${Math.round(kepler?.mapState?.pitch ?? 0)}, bearing ${Math.round(kepler?.mapState?.bearing ?? 0)}, zoom ${(kepler?.mapState?.zoom ?? 0).toFixed(1)}.`,
  ].join('\n');
}

function visState(store: Store): { datasets?: Record<string, DatasetLike>; layers?: LayerLike[] } | undefined {
  const state = store.getState() as { keplerGl?: Record<string, { visState?: { datasets?: Record<string, DatasetLike>; layers?: LayerLike[] } }> };
  return state.keplerGl?.[KEPLER_INSTANCE_ID]?.visState;
}

/** The map's row datasets as the tools read them; URL-backed tilesets have no rows and are left out. */
export function readTables(store: Store): TableView[] {
  const vis = visState(store);
  const layers = vis?.layers ?? [];
  const out: TableView[] = [];
  for (const [id, dataset] of Object.entries(vis?.datasets ?? {})) {
    const container = dataset.dataContainer;
    const fields = dataset.fields ?? [];
    if (!container || typeof container.numRows !== 'function' || dataset.type) {
      continue;
    }
    const indices = fields.map((f, i) => f.fieldIdx ?? i);
    const points: Array<[string, string]> = [];
    for (const layer of layers) {
      const columns = layer.config?.columns;
      const lat = columns?.lat?.value;
      const lng = columns?.lng?.value;
      if (layer.config?.dataId === id && lat && lng && !points.some(([a, b]) => a === lat && b === lng)) {
        points.push([lat, lng]);
      }
    }
    out.push({
      id,
      label: dataset.label || id,
      fields: fields.map((f) => ({ name: f.name, type: f.type ?? 'string' })),
      numRows: container.numRows(),
      valueAt: (row, col) => container.valueAt(row, indices[col]),
      points,
    });
  }
  return out;
}

/** The map's filters, one line each, for the system prompt. */
export function describeFilters(store: Store): string[] {
  return readFilters(store)
    .map((f) => {
      const name = Array.isArray(f.name) ? f.name.join(', ') : f.name;
      if (!name) {
        return '';
      }
      if (f.type === 'timeRange' && Array.isArray(f.value)) {
        const [from, to] = (f.value as number[]).map((ms) => new Date(ms).toISOString());
        return `${name} from ${from} to ${to} (the dashboard time range)`;
      }
      return `${name} = ${JSON.stringify(f.value)}`;
    })
    .filter(Boolean);
}

/** What "undo" puts back: kepler's saved config of the map, and the dashboard time range. */
export interface MapSnapshot {
  config: unknown;
  from?: string;
  to?: string;
  /** Figures that were filtering the layers: kepler's config reload drops them (below). */
  areaFilters: Array<{ type: string; coordinates?: unknown }>;
}

export function snapshotMap(store: Store): MapSnapshot | null {
  const kepler = (store.getState() as { keplerGl?: Record<string, unknown> }).keplerGl?.[KEPLER_INSTANCE_ID];
  if (!kepler) {
    return null;
  }
  const query = locationService.getSearchObject();
  return {
    config: KeplerGlSchema.getConfigToSave(kepler as never),
    from: query.from !== undefined ? String(query.from) : undefined,
    to: query.to !== undefined ? String(query.to) : undefined,
    areaFilters: areaFilterGeometries(store),
  };
}

function areaFilterGeometries(store: Store): Array<{ type: string; coordinates?: unknown }> {
  const filtering = new Set(readFigures(store).filter((f) => f.filterId).map((f) => f.id));
  return readDrawnAreas(store)
    .filter((a) => filtering.has(a.id))
    .map((a) => a.geometry);
}

/**
 * Puts a snapshot back: kepler resets its layers, filters, interactions, base
 * map and camera and merges the saved ones onto the rows it already holds,
 * the way a saved map is loaded. The time range only when it moved.
 */
export function restoreMap(store: Store, snapshot: MapSnapshot): UndoResult {
  const parsed = KeplerGlSchema.parseSavedConfig(snapshot.config as never);
  if (parsed) {
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, receiveMapConfig(parsed as never, { keepExistingConfig: false })));
  }
  // A polygon filter comes back from the reload as a bare figure (kepler merges filters before the
  // layers they name, and drops it): the histogram counted the whole world again after an undo.
  // Re-applying it the way filter_area does puts the filter back.
  const area = snapshot.areaFilters.at(-1);
  if (area && areaFilterGeometries(store).length === 0) {
    const id = drawArea(store.dispatch, area, readFigures(store));
    applyAreaFilter(store, store.dispatch, id);
  }
  const query = locationService.getSearchObject();
  let timeRange: UndoResult['timeRange'];
  if (snapshot.from !== undefined && snapshot.to !== undefined && (String(query.from) !== snapshot.from || String(query.to) !== snapshot.to)) {
    locationService.partial({ from: snapshot.from, to: snapshot.to }, true);
    timeRange = { from: readableTime(snapshot.from), to: readableTime(snapshot.to) };
  }
  return { timeRange, areaFilter: areaFilterGeometries(store).length > 0 };
}

const readableTime = (t: string) => (/^\d+$/.test(t) ? new Date(Number(t)).toISOString() : t);

export function mapActions(store: Store, undo: () => UndoResult | null = () => null): MapActions {
  const dispatch = store.dispatch;
  return {
    filterRange: (field, range) => applyRangeFilter(store, dispatch, field, range),
    filterValues: (field, values) => applyFieldFilter(store, dispatch, field, values),
    clearFilter: (field) => removeFieldFilter(store, dispatch, field),
    clearAllFilters: () => {
      // The time filter belongs to the dashboard time range (timeSync), not to the viewer's question.
      const fields = readFilters(store)
        .filter((f) => f.type !== 'timeRange')
        .map((f) => (Array.isArray(f.name) ? f.name[0] : f.name))
        .filter((name): name is string => Boolean(name));
      for (const field of fields) {
        removeFieldFilter(store, dispatch, field);
      }
      return fields;
    },
    fitBounds: (bounds) => fitMapToBounds(dispatch, bounds),
    addLayer: (spec, extentKm) => addLayerConfig(store, buildLayerConfig(spec, `ask-${Date.now().toString(36)}`, extentKm)),
    addLayerConfig: (config) =>
      addLayerConfig(store, { ...config, id: `${String(config.id ?? 'ask')}-${Date.now().toString(36)}` }),
    visibleLayersOf: (dataId) =>
      (instance(store)?.visState?.layers ?? []).filter((l) => l.config?.dataId === dataId && l.config?.isVisible !== false).map((l) => l.id),
    updateLayer: (ref, change) => updateLayer(store, ref, change),
    removeLayer: (ref) => {
      const layer = findLayer(store, ref);
      if (!layer) {
        return { error: `No layer "${ref}".` };
      }
      if (!addedLayers.get(store)?.has(layer.id)) {
        return { error: 'That layer came with the panel: hide it with update_layer visible=false instead.' };
      }
      dispatch(wrapTo(KEPLER_INSTANCE_ID, removeLayer(layer.id)));
      addedLayers.get(store)?.delete(layer.id);
      return { id: layer.id };
    },
    setView: (view) => {
      const mapState: Record<string, unknown> = { ...view };
      if (view.pitch !== undefined) {
        // kepler only keeps a pitch while 3D (drag rotate) is on.
        mapState.dragRotate = view.pitch > 0 || (view.bearing ?? instance(store)?.mapState?.bearing ?? 0) !== 0;
      }
      dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap(mapState as never)));
    },
    pitch: () => instance(store)?.mapState?.pitch ?? 0,
    setBasemap: (id) => {
      if (!instance(store)?.mapStyle?.mapStyles?.[id]) {
        return false;
      }
      dispatch(wrapTo(KEPLER_INSTANCE_ID, mapStyleChange(id)));
      return true;
    },
    flyTo: (view, seconds) => {
      // kepler's own geocoder flies the same way: the transition rides on the map state.
      const mapState: Record<string, unknown> = {
        ...view,
        transitionDuration: Math.round(seconds * 1000),
        transitionInterpolator: new FlyToInterpolator(),
      };
      if (view.pitch !== undefined) {
        mapState.dragRotate = view.pitch > 0 || (view.bearing ?? 0) !== 0;
      }
      dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap(mapState as never)));
    },
    fadeByZoom: (ref, stops) => {
      const layer = findLayer(store, ref);
      if (!layer) {
        return { error: `No layer "${ref}".` };
      }
      const zoomOpacity = instance(store)?.visState?.interactionConfig?.zoomOpacity;
      if (!zoomOpacity) {
        return { error: 'This map has no fade-on-zoom interaction.' };
      }
      // One controller per layer: drop the layer from any other, then add its own.
      const controllers = (zoomOpacity.config?.controllers ?? [])
        .map((c) => ({ ...c, layerIds: c.layerIds.filter((id) => id !== layer.id) }))
        .filter((c) => c.layerIds.length > 0);
      if (stops) {
        controllers.push({ id: `ask-${layer.id}`.slice(0, 32), layerIds: [layer.id], stops });
      }
      dispatch(
        wrapTo(
          KEPLER_INSTANCE_ID,
          interactionConfigChange({
            ...zoomOpacity,
            enabled: controllers.length > 0 || zoomOpacity.enabled === true,
            config: { ...zoomOpacity.config, controllers },
          } as never)
        )
      );
      return { id: layer.id };
    },
    filterArea: (geometry) => {
      const id = drawArea(dispatch, geometry, readFigures(store));
      return applyAreaFilter(store, dispatch, id);
    },
    clearAreas: () => {
      const figures = readFigures(store);
      for (const figure of figures) {
        removeFigure(dispatch, figure);
      }
      return figures.length;
    },
    drawnAreas: () => readDrawnAreas(store),
    setTimeRange: (from, to) => locationService.partial({ from, to }, true),
    undo,
  };
}

/**
 * Applies a change to a live layer, one kepler action per part. The layer is
 * read again before each: every action replaces the layer object.
 */
function updateLayer(store: Store, ref: string, change: LayerChange): { id: string; type: string } | { error: string } {
  const first = findLayer(store, ref);
  if (!first) {
    return { error: `No layer "${ref}". Layers: ${(instance(store)?.visState?.layers ?? []).map((l) => `${l.id} "${l.config?.label ?? ''}"`).join(', ')}.` };
  }
  const id = first.id;
  const type = (first.type ?? '') as LayerType;
  const dispatch = store.dispatch;
  const live = () => findLayer(store, id) as never;
  const dataset = instance(store)?.visState?.datasets?.[first.config?.dataId ?? ''];
  const fieldOf = (name: string) => dataset?.fields?.find((f) => f.name === name);

  for (const [key, wanted] of [['colorBy', change.colorBy], ['sizeBy', change.sizeBy]] as const) {
    if (wanted && !fieldOf(wanted.name)) {
      return { error: `Layer ${id} draws ${dataset?.label ?? first.config?.dataId}, which has no column "${wanted.name}" (${key}).` };
    }
  }

  if (change.visible !== undefined || change.label !== undefined) {
    const config: Record<string, unknown> = {};
    if (change.visible !== undefined) {
      config.isVisible = change.visible;
    }
    if (change.label !== undefined) {
      config.label = change.label;
    }
    dispatch(wrapTo(KEPLER_INSTANCE_ID, layerConfigChange(live(), config)));
  }
  if (change.colorBy) {
    const field = fieldOf(change.colorBy.name);
    if (type === 'heatmap') {
      dispatch(wrapTo(KEPLER_INSTANCE_ID, layerVisualChannelConfigChange(live(), { weightField: field } as never, 'weight')));
    } else {
      dispatch(
        wrapTo(
          KEPLER_INSTANCE_ID,
          layerVisualChannelConfigChange(live(), { colorField: field, colorScale: colorScaleFor(type, field?.type) } as never, 'color')
        )
      );
    }
  }
  if (change.sizeBy) {
    const size = sizeChannel(type);
    if (!size) {
      return { error: `A ${type} layer has no size channel.` };
    }
    dispatch(wrapTo(KEPLER_INSTANCE_ID, layerVisualChannelConfigChange(live(), { [size.field]: fieldOf(change.sizeBy.name) } as never, size.channel)));
  }
  const visConfig = visConfigFor(type, change);
  if (change.threeD) {
    const heights = heightsFor(boundsKm(first.meta?.bounds));
    if (type === 'hexagon' || type === 'grid') {
      visConfig.elevationScale = heights.elevationScale;
    } else if (type === 'heatmap') {
      visConfig.surfaceHeight = heights.surfaceHeight;
    }
  }
  if (Object.keys(visConfig).length) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, layerVisConfigChange(live(), visConfig as never)));
  }
  return { id, type };
}

/** The diagonal of a layer's [west, south, east, north] bounds in kilometres. */
function boundsKm(bounds?: number[]): number {
  if (!bounds || bounds.length !== 4 || !bounds.every(Number.isFinite)) {
    return 100;
  }
  const [w, s, e, n] = bounds;
  const dx = (e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180);
  return Math.max(1, Math.hypot(dx, (n - s) * 110.57));
}

/** Adds a saved-format layer and remembers it as the assistant's (the only kind it may remove). */
function addLayerConfig(store: Store, config: Record<string, unknown>): { id: string } | { error: string } {
  const id = String(config.id);
  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, addLayer(config)));
  // kepler drops a config it cannot validate against the dataset, with only a console warning.
  if (!findLayer(store, id)) {
    return { error: `kepler refused the ${String(config.type)} layer for this dataset (is the layer type available in this panel?).` };
  }
  const mine = addedLayers.get(store) ?? new Set<string>();
  mine.add(id);
  addedLayers.set(store, mine);
  return { id };
}
