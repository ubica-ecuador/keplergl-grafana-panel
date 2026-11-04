/**
 * What a save keeps of the parts of the map still waiting for their data.
 *
 * kepler applies a saved config in pieces: a layer whose dataset is not there
 * yet — a raster scene a click resolves, a query that has not answered, a
 * dataset in the middle of a refresh — is parked in `layerToBeMerged`, and its
 * filters, its side of a split map, its tooltip fields and its place in a
 * layer group wait with it (`filterToBeMerged`, `splitMapsToBeMerged`,
 * `interactionToBeMerged`, `layerOrderToBeMerged`). They come back when the
 * data does. `getConfigToSave` writes the live state only, so a save made
 * while anything was parked wrote a map without it, and the next load had
 * nothing left to merge: firms-active-fires lost its Sentinel-2 before | after
 * layers and their split this way, saved with no fire clicked, and a map saved
 * while its queries were still running lost every layer, then kepler made
 * point layers of its own on the next load.
 *
 * This puts the parked parts back into the saved config, each where kepler
 * would have put it: layers and filters in the order the map was loaded with
 * (`preserveLayerOrder`, `preserveFilterOrder`), split sides into the panes the
 * map still has, tooltip fields beside the live ones. Only what kepler holds as
 * parked comes back, so a layer the user deleted stays deleted.
 *
 * kepler parks a layer in its loaded form, with the visual channels folded
 * into `config` (`VisualChannelSchemaV1.load`); the saved form keeps them in
 * `visualChannels`. Every `config` key that is not one of the saved layer
 * config's own properties is a channel's field or scale, so splitting on those
 * properties is the exact inverse of the fold.
 */

import { filterPropsV1, layerPropsV1 } from '@kepler.gl/schemas';

import type { SavedMapConfig } from '../data/mapConfig';

/** A layer as kepler parks it: the saved layer after `parseSavedConfig`. */
interface ParkedLayer {
  id: string;
  type?: string;
  config?: Record<string, unknown>;
}

type LayerOrderEntry = string | { id: string; layerOrder?: LayerOrderEntry[]; [key: string]: unknown };

interface SplitPane {
  layers?: Record<string, boolean>;
  [key: string]: unknown;
}

/** The parts of kepler's vis state this reads. */
export interface ParkedState {
  layerToBeMerged?: ParkedLayer[];
  layerOrderToBeMerged?: LayerOrderEntry[] | null;
  preserveLayerOrder?: string[];
  filterToBeMerged?: Array<{ id?: string } & Record<string, unknown>>;
  preserveFilterOrder?: string[];
  splitMapsToBeMerged?: SplitPane[];
  interactionToBeMerged?: { tooltip?: { fieldsToShow?: Record<string, unknown> } };
}

interface SavedVisState {
  layers?: Array<{ id: string } & Record<string, unknown>>;
  filters?: Array<{ id?: string } & Record<string, unknown>>;
  layerOrder?: LayerOrderEntry[];
  splitMaps?: SplitPane[];
  interactionConfig?: { tooltip?: { fieldsToShow?: Record<string, unknown> } & Record<string, unknown> } & Record<
    string,
    unknown
  >;
  [key: string]: unknown;
}

const schemaKeys = (schema: unknown): string[] =>
  Object.keys((schema as { properties?: Record<string, unknown> } | null)?.properties ?? {});

/** The saved layer config's own keys: `dataId`, `label`, `columns`, `visConfig`, … */
const LAYER_CONFIG_KEYS = new Set(schemaKeys((layerPropsV1 as Record<string, unknown>).config));
const FILTER_KEYS = Object.keys(filterPropsV1 as Record<string, unknown>);

/** A parked layer back in the form `getConfigToSave` writes. */
export function savedLayerOf(parked: ParkedLayer): { id: string } & Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const visualChannels: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parked.config ?? {})) {
    (LAYER_CONFIG_KEYS.has(key) ? config : visualChannels)[key] = value;
  }
  return { id: parked.id, type: parked.type, config, visualChannels };
}

function savedFilterOf(parked: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(FILTER_KEYS.filter((key) => key in parked).map((key) => [key, parked[key]]));
}

/**
 * `items` with each of `pending` placed where `order` puts it: before the first
 * item that `order` puts after it. Items `order` does not name do not count
 * (kepler puts a layer added since the load on top), and a pending item it does
 * not name goes last.
 */
export function insertInOrder<T>(items: T[], pending: T[], idOf: (item: T) => string, order: string[]): T[] {
  const rank = (item: T) => order.indexOf(idOf(item));
  const result = [...items];
  const ranked = pending.filter((item) => rank(item) !== -1).sort((a, b) => rank(a) - rank(b));
  for (const item of ranked) {
    const at = result.findIndex((other) => rank(other) > rank(item));
    result.splice(at === -1 ? result.length : at, 0, item);
  }
  return [...result, ...pending.filter((item) => rank(item) === -1)];
}

const entryId = (entry: LayerOrderEntry) => (typeof entry === 'string' ? entry : entry.id);

/** The group of `parkedOrder` that holds layer `id`, and that group's own order. */
function parkedGroupOf(parkedOrder: LayerOrderEntry[], id: string): { id: string; order: string[] } | null {
  for (const entry of parkedOrder) {
    if (typeof entry !== 'string') {
      const inner = entry.layerOrder ?? [];
      if (inner.some((child) => entryId(child) === id)) {
        return { id: entry.id, order: inner.map(entryId) };
      }
      const nested = parkedGroupOf(inner, id);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

/** Puts `ids` into `layerOrder`, inside their group when the saved order still has it. */
function layerOrderWith(
  layerOrder: LayerOrderEntry[],
  ids: string[],
  topOrder: string[],
  parkedOrder: LayerOrderEntry[] | null | undefined
): LayerOrderEntry[] {
  const top: string[] = [];
  const byGroup = new Map<string, { order: string[]; ids: string[] }>();
  for (const id of ids) {
    const group = parkedOrder ? parkedGroupOf(parkedOrder, id) : null;
    if (group && hasGroup(layerOrder, group.id)) {
      const held = byGroup.get(group.id) ?? { order: group.order, ids: [] };
      held.ids.push(id);
      byGroup.set(group.id, held);
    } else {
      top.push(id);
    }
  }
  const intoGroups = (entries: LayerOrderEntry[]): LayerOrderEntry[] =>
    entries.map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      const inner = intoGroups(entry.layerOrder ?? []);
      const held = byGroup.get(entry.id);
      return { ...entry, layerOrder: held ? insertInOrder(inner, held.ids, entryId, held.order) : inner };
    });
  return insertInOrder(intoGroups(layerOrder), top, entryId, topOrder);
}

function hasGroup(entries: LayerOrderEntry[], id: string): boolean {
  return entries.some(
    (entry) => typeof entry !== 'string' && (entry.id === id || hasGroup(entry.layerOrder ?? [], id))
  );
}

const pick = (record: Record<string, boolean> | undefined, ids: string[]) =>
  Object.fromEntries(ids.filter((id) => record && id in record).map((id) => [id, Boolean(record?.[id])]));

/** The saved config with what kepler still holds parked put back in. */
export function withParkedParts(saved: SavedMapConfig, parked: ParkedState): SavedMapConfig {
  const visState = (saved.config?.visState ?? {}) as SavedVisState;
  const layers = visState.layers ?? [];
  const savedIds = new Set(layers.map((layer) => layer.id));
  const parkedLayers = (parked.layerToBeMerged ?? []).filter((layer) => layer?.id && !savedIds.has(layer.id));
  // Several refreshes in a row can park the same layer twice; the latest wins.
  const latest = new Map(parkedLayers.map((layer) => [layer.id, layer]));
  const pendingLayers = [...latest.values()].map(savedLayerOf);
  const pendingIds = pendingLayers.map((layer) => layer.id);

  const filters = visState.filters ?? [];
  const filterIds = new Set(filters.map((filter) => filter.id));
  const pendingFilters = (parked.filterToBeMerged ?? [])
    .filter((filter) => filter?.id && !filterIds.has(filter.id))
    .map(savedFilterOf);

  const parkedFields = parked.interactionToBeMerged?.tooltip?.fieldsToShow ?? {};
  const tooltip = visState.interactionConfig?.tooltip;
  const liveFields = tooltip?.fieldsToShow ?? {};
  const pendingFields = Object.fromEntries(Object.entries(parkedFields).filter(([dataId]) => !(dataId in liveFields)));

  if (!pendingLayers.length && !pendingFilters.length && !Object.keys(pendingFields).length) {
    return saved;
  }

  const next: SavedVisState = { ...visState };
  if (pendingLayers.length) {
    const order = parked.preserveLayerOrder ?? [];
    next.layers = insertInOrder(layers, pendingLayers, (layer) => layer.id, order);
    if (Array.isArray(visState.layerOrder)) {
      next.layerOrder = layerOrderWith(visState.layerOrder, pendingIds, order, parked.layerOrderToBeMerged);
    }
    const panes = visState.splitMaps ?? [];
    const parkedPanes = parked.splitMapsToBeMerged ?? [];
    if (panes.length) {
      next.splitMaps = panes.map((pane, i) => ({
        ...pane,
        layers: { ...pane.layers, ...pick(parkedPanes[i]?.layers, pendingIds) },
      }));
    } else if (!layers.length && parkedPanes.some((pane) => Object.keys(pick(pane.layers, pendingIds)).length)) {
      // Nothing of the map is live yet, so kepler has not made the panes: the
      // parked ones are the split the map was saved with.
      next.splitMaps = parkedPanes.map((pane) => ({ ...pane, layers: pick(pane.layers, pendingIds) }));
    }
  }
  if (pendingFilters.length) {
    next.filters = insertInOrder(
      filters,
      pendingFilters,
      (filter) => String(filter.id),
      parked.preserveFilterOrder ?? []
    );
  }
  if (Object.keys(pendingFields).length && tooltip) {
    next.interactionConfig = {
      ...visState.interactionConfig,
      tooltip: { ...tooltip, fieldsToShow: { ...liveFields, ...pendingFields } },
    };
  }
  return { ...saved, config: { ...saved.config, visState: next } };
}
