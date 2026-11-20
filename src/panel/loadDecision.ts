import { isPanelEsriId } from '../data/esriDataset';
import { SavedMapConfig } from '../data/mapConfig';
import { isPanelRasterId } from '../data/rasterDataset';
import { isPanelWmsId } from '../data/wmsDataset';
import { isPanelXyzId } from '../data/xyzDataset';
import { isPanelZarrId } from '../data/zarrDataset';
import { savedViewportOf } from './viewportGuard';

export type LoadAction = 'rebuild' | 'refresh' | 'rasters' | 'none';

interface LoadState {
  /** Whether kepler has already been handed a full map. */
  hasLoaded: boolean;
  /** The config the current map was built from. */
  appliedConfig: SavedMapConfig | null | undefined;
  /** The config the panel options currently carry. */
  currentConfig: SavedMapConfig | null | undefined;
  /** The datasets object last handed to kepler — an identity token, not data. */
  appliedDatasets?: unknown;
  /** The datasets object this render carries. */
  currentDatasets?: unknown;
  /** The raster list last handed to kepler — an identity token again. */
  appliedRasters?: unknown;
  /** The raster list this render carries. */
  currentRasters?: unknown;
}

/**
 * Whether the map is built now, or waits for its queries.
 *
 * It is built as soon as there is anything to draw: a query's rows or
 * service, or a tileset the saved map carries — that one is content in its own
 * right, and a panel whose map is one vector tile layer over a base map has no
 * rows at all to wait for.
 *
 * And when the queries have answered nothing — one failed, or returned no rows
 * — on a map saved with a view of its own. Waiting there was waiting for rows
 * that had already not come: the saved config, view included, was never
 * applied, and a map saved over Cuenca whose only query failed showed kepler's
 * default, San Francisco. Built from its config, it opens on its view, and
 * rows that come later take the refresh path, where they find the layers the
 * config saved for them waiting.
 *
 * Not without a saved view: built empty, the map would take the first rows on
 * the refresh path, which leaves the view alone, where a map saved without one
 * is meant to be framed on them. Nor before the queries have answered: their
 * first, empty data is not an answer.
 */
export function shouldBuildMap({
  hasContent,
  queriesAnswered,
  mapConfig,
}: {
  /** Rows, a raster, a WMS, a Zarr, an Image Service or tiles from the queries. */
  hasContent: boolean;
  /** Whether the queries are done or failed, rather than not run or still running. */
  queriesAnswered: boolean;
  mapConfig?: SavedMapConfig | null;
}): boolean {
  if (hasContent || Boolean(mapConfig?.datasets?.length)) {
    return true;
  }
  return queriesAnswered && savedViewportOf(mapConfig) !== null;
}

/**
 * Chooses between rebuilding the map, refreshing its data, reconciling the
 * rasters alone, and doing nothing.
 *
 * `rebuild` is `addDataToMap`: it constructs layers and frames the viewport
 * around the data. `refresh` is `replaceDataInMap`: it swaps the rows while
 * preserving everything the user configured on top. `none` is exactly that,
 * and it is not an optimisation: `replaceDataInMap` empties the kepler store
 * and restores it through async tasks, so a gratuitous refresh hands anything
 * that reads the store in the same commit — the config snapshot behind "Save
 * current map configuration", above all — a map with no layers, no filters and
 * no datasets. Grafana deep-clones the panel options on every options change,
 * which made every click in the panel editor exactly that gratuitous refresh.
 *
 * `rasters` is the fourth, and it exists because rows and scenes do not always
 * move together. A band combination is a dashboard variable the map's own
 * queries deliberately do not name — naming it would re-run the catalogue
 * search on every pick — so a change of combination rebuilds the raster list
 * with the rows untouched. Judged on the rows alone that read as `none`, and
 * the dropdown reached kepler only for someone who reloaded the page. Judged as
 * a full `refresh` it would replace the row datasets too, which costs a
 * `replaceDataInMap` per query and blinks layers that did not change; so the
 * narrow action says what actually happened.
 *
 * Tracked as an explicit `hasLoaded` flag rather than inferred from the config
 * alone, because "no config yet" and "no config saved" are both `undefined` and
 * comparing them would make the first load look like a refresh.
 */
export function decideLoadAction({
  hasLoaded,
  appliedConfig,
  currentConfig,
  appliedDatasets,
  currentDatasets,
  appliedRasters,
  currentRasters,
}: LoadState): LoadAction {
  if (!hasLoaded) {
    return 'rebuild';
  }
  // kepler will not accept a config once data is loaded, so a config change has
  // to rebuild rather than patch.
  if (!isSameConfig(appliedConfig, currentConfig)) {
    return 'rebuild';
  }
  // Datasets are compared by identity, not value: the memo that builds them
  // only re-runs when a query actually re-ran, so a fresh object means fresh
  // rows, and value-comparing row arrays on every render would not be free.
  if (currentDatasets !== appliedDatasets) {
    return 'refresh';
  }
  // The rasters likewise, and the identity holds for the same reason: their
  // memo does not re-run for an options clone, only for a query re-run or a
  // change of band combination. `refreshRasters` compares scenes by url
  // afterwards, so even a list rebuilt for nothing dispatches nothing.
  return currentRasters === appliedRasters ? 'none' : 'rasters';
}

/**
 * Compares two saved configs by value.
 *
 * Identity is not usable here: Grafana rebuilds the panel options object on
 * every options change, so the very same saved config arrives as a new object
 * each time. Treating that as a change rebuilt the map — discarding the viewport
 * the user was looking at — which is precisely what happened when they clicked
 * "Save current map configuration", since that click is itself an options
 * change. Both configs come from the same serialisation, so their key order
 * matches and a JSON comparison is sound.
 */
function isSameConfig(a: SavedMapConfig | null | undefined, b: SavedMapConfig | null | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Splits a refresh into the datasets kepler already holds and the ones it does not.
 *
 * The two need different calls. `updateVisData` cannot swap the rows of a
 * dataset kepler already knows: `createNewDataEntry` sees the id, takes the
 * incremental-batch path meant for streaming a dataset in pieces, and ends at
 * `dataContainer.update?.()` — a method `RowDataContainer` does not implement.
 * The optional chaining swallows it and the old rows stay. `replaceDataInMap`
 * does the swap, but only for an id that exists, so a query that gains a new
 * refId still has to go through `updateVisData`.
 */
export function splitRefresh<T extends { id: string }>(
  datasets: T[],
  knownIds: readonly string[]
): { replace: T[]; add: T[] } {
  const known = new Set(knownIds);
  return {
    replace: datasets.filter((dataset) => known.has(dataset.id)),
    add: datasets.filter((dataset) => !known.has(dataset.id)),
  };
}

/**
 * Splits a raster refresh four ways: add, replace, keep, remove.
 *
 * The extra buckets a row dataset does not need come from what a raster costs
 * to swap. `replaceDataInMap` empties and rebuilds the dataset, and the layer's
 * tiles are refetched with it — so an unnecessary swap is a visible blink, not
 * a wasted cycle. The dashboard's own 30-second auto-refresh re-runs the query
 * and hands back a fresh object describing the very same scene, which is why
 * the comparison is on `metadataUrl` and not on object identity: the identity
 * is new every time, the scene is not.
 *
 * `remove` is the other side of it. A range with no scene under the cloud
 * threshold returns no rows at all, and a raster left behind then shows imagery
 * from outside the range as though it belonged to it. Only ids the panel minted
 * are removable — a tileset the user added through kepler's own Add Data is
 * theirs, and disappears from nothing but their own hand.
 */
export function splitRasterRefresh<T extends { id: string; metadataUrl: string }>(
  rasters: T[],
  known: ReadonlyArray<{ id: string; metadataUrl?: string }>
): { add: T[]; replace: T[]; keep: T[]; remove: string[] } {
  const byId = new Map(known.map((dataset) => [dataset.id, dataset.metadataUrl]));
  const wanted = new Set(rasters.map((raster) => raster.id));

  const add: T[] = [];
  const replace: T[] = [];
  const keep: T[] = [];

  for (const raster of rasters) {
    if (!byId.has(raster.id)) {
      add.push(raster);
    } else if (byId.get(raster.id) === raster.metadataUrl) {
      keep.push(raster);
    } else {
      replace.push(raster);
    }
  }

  const remove = known
    .map((dataset) => dataset.id)
    .filter((id) => !wanted.has(id) && isPanelRasterId(id));

  return { add, replace, keep, remove };
}

/**
 * Splits a WMS refresh the same four ways, on a different identity.
 *
 * Not `splitRasterRefresh` with another argument, because what makes two WMS
 * layers the same thing is not a url: it is the service **and** the layer name
 * together, and either can change while the other stands. A query whose layer
 * variable moves from rain to cloud cover is pointing at the same endpoint and
 * must still be rebuilt.
 *
 * What is *not* here is the date. Moving through the timeline changes no
 * dataset at all — it is a `visConfig` change on the layer — so a refresh never
 * sees it, and a query re-run that returns the same service and layer with a
 * hundred new dates is a `keep`.
 */
export function splitWmsRefresh<
  T extends { id: string; serviceUrl: string; layerName: string; bbox?: readonly number[] | null },
>(
  wanted: T[],
  known: ReadonlyArray<{ id: string; serviceUrl?: string; layerName?: string; bbox?: readonly number[] | null }>
): { add: T[]; replace: T[]; keep: T[]; remove: string[] } {
  // The box too, rare as a change of it is: the layer cuts its picture to the
  // box its dataset carries (`wmsExtent.ts`), so a new box on the same layer
  // left as a `keep` would go on cutting at the old one.
  const identity = (dataset: { serviceUrl?: string; layerName?: string; bbox?: readonly number[] | null }) =>
    `${dataset.serviceUrl ?? ''}|${dataset.layerName ?? ''}|${dataset.bbox?.join(' ') ?? ''}`;
  const byId = new Map(known.map((dataset) => [dataset.id, identity(dataset)]));
  const ids = new Set(wanted.map((dataset) => dataset.id));

  const add: T[] = [];
  const replace: T[] = [];
  const keep: T[] = [];

  for (const dataset of wanted) {
    if (!byId.has(dataset.id)) {
      add.push(dataset);
    } else if (byId.get(dataset.id) === identity(dataset)) {
      keep.push(dataset);
    } else {
      replace.push(dataset);
    }
  }

  // Only ids the panel minted: a WMS someone added through kepler's own Add
  // Data lives in the same store and must survive every refresh the query does.
  const remove = known.map((dataset) => dataset.id).filter((id) => !ids.has(id) && isPanelWmsId(id));

  return { add, replace, keep, remove };
}

/**
 * Splits a Zarr refresh the same four ways, on a third identity.
 *
 * What makes two Zarr layers the same thing is the store **and** the variable.
 * Either can change while the other stands: a dashboard variable moving from
 * `precip` to `error` is pointing at the same store and must still be rebuilt,
 * and the same variable name means nothing across two stores.
 *
 * What is *not* here is the moment. Moving through the timeline rewrites one
 * query parameter of the tile url — a `visConfig` change on the layer — so a
 * refresh never sees it, and a query re-run returning the same store and
 * variable with a hundred new dates is a `keep`.
 */
export function splitZarrRefresh<T extends { id: string; storeUrl: string; variable: string }>(
  wanted: T[],
  known: ReadonlyArray<{ id: string; storeUrl?: string; variable?: string }>
): { add: T[]; replace: T[]; keep: T[]; remove: string[] } {
  const identity = (dataset: { storeUrl?: string; variable?: string }) =>
    `${dataset.storeUrl ?? ''}|${dataset.variable ?? ''}`;
  const byId = new Map(known.map((dataset) => [dataset.id, identity(dataset)]));
  const ids = new Set(wanted.map((dataset) => dataset.id));

  const add: T[] = [];
  const replace: T[] = [];
  const keep: T[] = [];

  for (const dataset of wanted) {
    if (!byId.has(dataset.id)) {
      add.push(dataset);
    } else if (byId.get(dataset.id) === identity(dataset)) {
      keep.push(dataset);
    } else {
      replace.push(dataset);
    }
  }

  const remove = known.map((dataset) => dataset.id).filter((id) => !ids.has(id) && isPanelZarrId(id));

  return { add, replace, keep, remove };
}

/**
 * Splits an Image Service refresh the same four ways, on a fourth identity.
 *
 * What makes two Image Service layers the same thing is the **endpoint** and
 * what it is told to draw — the rendering rule. Deliberately *not* the mosaic
 * rule, and that omission is the whole point of a separate function: the mosaic
 * rule is which rasters to show, which on a multi-temporal service is the
 * *year*, and a year changes constantly. It rides in the layer's `visConfig`
 * exactly as the Zarr layer's time label does, so a query re-run that returns
 * the same service with another year is a `keep` rather than a rebuild — and
 * the layer the user had named, faded or reordered survives the step.
 */
export function splitEsriRefresh<T extends { id: string; serviceUrl: string; renderingRule?: string }>(
  wanted: T[],
  known: ReadonlyArray<{ id: string; serviceUrl?: string; renderingRule?: string }>
): { add: T[]; replace: T[]; keep: T[]; remove: string[] } {
  const identity = (dataset: { serviceUrl?: string; renderingRule?: string }) =>
    `${dataset.serviceUrl ?? ''}|${dataset.renderingRule ?? ''}`;
  const byId = new Map(known.map((dataset) => [dataset.id, identity(dataset)]));
  const ids = new Set(wanted.map((dataset) => dataset.id));

  const add: T[] = [];
  const replace: T[] = [];
  const keep: T[] = [];

  for (const dataset of wanted) {
    if (!byId.has(dataset.id)) {
      add.push(dataset);
    } else if (byId.get(dataset.id) === identity(dataset)) {
      keep.push(dataset);
    } else {
      replace.push(dataset);
    }
  }

  const remove = known.map((dataset) => dataset.id).filter((id) => !ids.has(id) && isPanelEsriId(id));

  return { add, replace, keep, remove };
}

/**
 * Splits a refresh of a query's tiles the same four ways, on a fifth identity.
 *
 * Everything the dataset carries: the template, its zoom levels and their
 * names, and the box. None of it moves with time — a tile service has no
 * clock here — so a re-run that returns the same service is a `keep`, and
 * anything else is a service the layer must be rebuilt on (a new box would
 * otherwise go on cutting at the old one, as with a WMS).
 */
export function splitXyzRefresh<
  T extends {
    id: string;
    url: string;
    minZoom?: number;
    maxZoom?: number;
    zoomIds?: Record<string, string>;
    bbox?: readonly number[] | null;
  },
>(
  wanted: T[],
  known: ReadonlyArray<{ id: string; identity: string }>
): { add: T[]; replace: T[]; keep: T[]; remove: string[] } {
  const byId = new Map(known.map((dataset) => [dataset.id, dataset.identity]));
  const ids = new Set(wanted.map((dataset) => dataset.id));

  const add: T[] = [];
  const replace: T[] = [];
  const keep: T[] = [];

  for (const dataset of wanted) {
    if (!byId.has(dataset.id)) {
      add.push(dataset);
    } else if (byId.get(dataset.id) === xyzIdentity(dataset)) {
      keep.push(dataset);
    } else {
      replace.push(dataset);
    }
  }

  // Only ids the panel minted: a Geomap's XYZ layer, saved with the map, is
  // the same dataset type and must survive every refresh.
  const remove = known.map((dataset) => dataset.id).filter((id) => !ids.has(id) && isPanelXyzId(id));

  return { add, replace, keep, remove };
}

/** What makes two tile datasets the same: every key of what they carry, in one string. */
export function xyzIdentity(dataset: {
  url?: string;
  minZoom?: number;
  maxZoom?: number;
  zoomIds?: Record<string, string>;
  bbox?: readonly number[] | null;
}): string {
  return JSON.stringify([
    dataset.url ?? '',
    dataset.minZoom ?? null,
    dataset.maxZoom ?? null,
    dataset.zoomIds ?? null,
    dataset.bbox ?? null,
  ]);
}
