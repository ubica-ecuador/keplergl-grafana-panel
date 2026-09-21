import { getDatasetFieldIndexForFilter } from '@kepler.gl/table';
import { getFilterFunction, getPolygonFilterFunctor, isValidFilterValue } from '@kepler.gl/utils';

import type { HaloDataset, HaloInput, HaloLayer, Selection } from './selectionHalo';

/**
 * kepler's vis state, read into what `selectionHalo` decides over.
 *
 * Typed loosely on purpose: kepler's own state types pull its whole graph into
 * whatever imports them. What is read is exactly what the halo needs — each
 * layer's type, visibility, dataset and column roles, each dataset's columns
 * and rows, the filters, and the split.
 */
export interface VisStateLike {
  layers?: Array<{
    id: string;
    type: string | null;
    config: {
      dataId: string | null;
      isVisible: boolean;
      columns?: Record<string, { fieldIdx?: number } | undefined>;
      columnMode?: string;
      visConfig?: Record<string, unknown>;
      sizeField?: unknown;
    };
  }>;
  datasets?: Record<
    string,
    {
      fields: Array<{ name: string }>;
      dataContainer: { numRows: () => number; valueAt: (row: number, column: number) => unknown };
      /** Bumped by kepler when rows change inside the same container. */
      dataRevision?: number;
    }
  >;
  filters?: Array<{
    id: string;
    type: string | null;
    value: unknown;
    dataId: string | string[];
    enabled?: boolean;
    /** A polygon filter's layers: the only ones it cuts. */
    layerId?: string[];
  }>;
  splitMaps?: Array<{ layers?: Record<string, boolean> }>;
}

const ROLES = ['lat', 'lng', 'geojson', 'hex_id'] as const;

/** kepler's default point radius, when a layer's config does not carry one. */
const DEFAULT_POINT_RADIUS = 10;

function haloLayers(visState: VisStateLike): HaloLayer[] {
  return (visState.layers ?? []).flatMap((layer) => {
    const { dataId, isVisible, columns = {}, columnMode, visConfig = {}, sizeField } = layer.config;
    if (!dataId || !layer.type) {
      return [];
    }

    const roles: Partial<Record<(typeof ROLES)[number], number>> = {};
    for (const role of ROLES) {
      const fieldIdx = columns[role]?.fieldIdx;
      if (typeof fieldIdx === 'number' && fieldIdx >= 0) {
        roles[role] = fieldIdx;
      }
    }

    // kepler's own rule (`PointLayer.renderLayer`): the radius is only fixed in
    // metres when a column sizes the points *and* fixedRadius is on.
    const sized = Boolean(sizeField);
    const range = visConfig.radiusRange;
    const radius =
      layer.type === 'point'
        ? {
            base:
              sized && Array.isArray(range) && range.length
                ? Math.max(...range.map(Number))
                : Number(visConfig.radius ?? DEFAULT_POINT_RADIUS),
            fixed: Boolean(visConfig.fixedRadius) && sized,
          }
        : undefined;

    return [{ id: layer.id, type: layer.type, isVisible, dataId, columns: roles, columnMode, radius }];
  });
}

function haloDatasets(visState: VisStateLike): Record<string, HaloDataset> {
  const datasets: Record<string, HaloDataset> = {};
  for (const [id, dataset] of Object.entries(visState.datasets ?? {})) {
    const container = dataset.dataContainer;
    datasets[id] = {
      fieldNames: dataset.fields.map((field) => field.name),
      numRows: container.numRows(),
      valueAt: (row, column) => container.valueAt(row, column),
      cacheKey: container,
      revision: dataset.dataRevision,
    };
  }
  return datasets;
}

/** kepler's `FILTER_TYPES.polygon`. */
const POLYGON = 'polygon';

/**
 * Whether a row of a layer passes kepler's filters, asked the way kepler asks it.
 *
 * kepler's `filteredIndex` only reflects its CPU filters; range and time filters
 * run on the GPU and never reach it. So every valid filter on the dataset — CPU
 * and GPU, range and time — is evaluated here with kepler's own
 * `getFilterFunction`, with the `{ index, dataContainer }` context
 * `filterDataByFilterTypes` hands it, skipping what kepler skips: disabled
 * filters and ones whose value is not valid yet.
 *
 * A polygon filter is not the dataset's but its layers': kepler cuts only the
 * layers in its `layerId`, each with its own position accessor
 * (`computePolygonFilteredIndexByLayer`), and leaves the others whole. So it
 * counts only for a layer it targets, through `getPolygonFilterFunctor` for
 * that layer. Only the selected rows are ever asked, so this costs a handful of
 * calls per repaint.
 */
function rowPassesFor(visState: VisStateLike): HaloInput['rowPasses'] {
  type Predicate = (context: { index: number; dataContainer: unknown }) => boolean;
  const perDataset = new Map<string, Predicate[]>();
  const perLayer = new Map<string, Predicate[]>();

  const liveFilters = (dataId: string) =>
    (visState.filters ?? []).filter((filter) => {
      const ids = Array.isArray(filter.dataId) ? filter.dataId : [filter.dataId];
      return ids.includes(dataId) && filter.enabled !== false && isValidFilterValue(filter.type, filter.value);
    });

  const datasetPredicates = (dataId: string): Predicate[] => {
    const known = perDataset.get(dataId);
    if (known) {
      return known;
    }
    const dataset = visState.datasets?.[dataId];
    const predicates: Predicate[] = [];
    if (dataset) {
      for (const filter of liveFilters(dataId)) {
        if (filter.type === POLYGON) {
          continue;
        }
        const fieldIndex = getDatasetFieldIndexForFilter(dataId, filter as never);
        const field = fieldIndex >= 0 ? dataset.fields[fieldIndex] : null;
        predicates.push(
          getFilterFunction(
            field as never,
            dataId,
            filter as never,
            (visState.layers ?? []) as never,
            dataset.dataContainer as never
          ) as unknown as Predicate
        );
      }
    }
    perDataset.set(dataId, predicates);
    return predicates;
  };

  const layerPredicates = (dataId: string, layerId: string): Predicate[] => {
    const key = JSON.stringify([dataId, layerId]);
    const known = perLayer.get(key);
    if (known) {
      return known;
    }
    const dataset = visState.datasets?.[dataId];
    const layer = visState.layers?.find((candidate) => candidate.id === layerId && candidate.config.dataId === dataId);
    const predicates: Predicate[] = [];
    if (dataset && layer) {
      for (const filter of liveFilters(dataId)) {
        if (filter.type === POLYGON && filter.layerId?.includes(layerId)) {
          predicates.push(getPolygonFilterFunctor(layer, filter, dataset.dataContainer) as Predicate);
        }
      }
    }
    perLayer.set(key, predicates);
    return predicates;
  };

  return (dataId, row, layerId) => {
    const dataContainer = visState.datasets?.[dataId]?.dataContainer;
    const context = { index: row, dataContainer };
    const passes = (predicate: Predicate) => predicate(context);
    return datasetPredicates(dataId).every(passes) && layerPredicates(dataId, layerId).every(passes);
  };
}

/** Everything `selectionHalo` needs for one side of the map. */
export function haloInputFrom({
  visState,
  zoom,
  index,
  selection,
}: {
  visState: VisStateLike;
  zoom: number;
  /** `MapContainer`'s index: 0, or 1 on the right of a split map. */
  index: number;
  selection: Selection;
}): HaloInput {
  const split = visState.splitMaps?.length ? visState.splitMaps : null;
  return {
    selection,
    layers: haloLayers(visState),
    datasets: haloDatasets(visState),
    rowPasses: rowPassesFor(visState),
    // kepler's getMapLayersFromSplitMaps: a side without a layer list shows
    // every layer (isLayerVisible), the same as an unsplit map.
    sideLayers: split?.[index]?.layers ?? null,
    zoom,
  };
}
