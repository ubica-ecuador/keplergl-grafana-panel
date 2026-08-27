import {
  addDataToMap,
  addLayer,
  createOrUpdateFilter,
  fitBounds,
  interactionConfigChange,
  layerConfigChange,
  layerVisConfigChange,
  mapStyleChange,
  removeDataset,
  removeFilter,
  removeLayer,
  toggleLayerAnimation,
  replaceDataInMap,
  setLayerAnimationTime,
  toggleSidePanel,
  updateDatasetProps,
  updateMap,
  updateVisData,
  wrapTo,
} from '@kepler.gl/actions';
import { ALL_FIELD_TYPES, PMTilesType, REMOTE_TILE, RemoteTileFormat } from '@kepler.gl/constants';
import { getApplicationConfig } from '@kepler.gl/utils';
import { processRowObject } from '@kepler.gl/processors';
import KeplerGlSchema, { datasetSchema, VERSIONS, type SavedDatasetV1 } from '@kepler.gl/schemas';
import type { ProtoDataset } from '@kepler.gl/types';
import type { Dispatch, Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { isPanelRasterId, type RasterDataset } from '../data/rasterDataset';
import { isPanelWmsId, wmsCalendarDatasetId, type WmsDataset } from '../data/wmsDataset';
import { zarrCalendarDatasetId, type ZarrDataset } from '../data/zarrDataset';
import { rowFieldValue, wmsFeatureValues } from './clickSync';
import type { FlowLayerConfig } from '../data/buildFlows';
import type { TripLayerConfig } from '../data/buildTripLayer';
import {
  keepRemoteDatasets,
  REMOTE_DATASET_TYPES,
  type SavedMapConfig,
  type SavedRemoteDataset,
} from '../data/mapConfig';
import { viewportFromMapState, type MapStateLike } from './windViewport';
import type { ViewportBounds } from './viewportSync';
import {
  findTimeFieldName,
  readTimeFilterDomain,
  readTimeFilterValue,
  TIME_FILTER_TYPE,
  type TimeRangeMs,
} from './timeSync';
import { supersededTripLayerIds } from './autoLayers';
import { splitRasterRefresh, splitRefresh, splitWmsRefresh, splitZarrRefresh } from './loadDecision';
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
 *
 * The saved config's own URL-backed datasets — tilesets the user added inside
 * kepler — go in the *same* payload as the query data, not a follow-up call:
 * `updateVisDataUpdater` runs `Task.allSettled` across every dataset in a
 * payload and merges the config only once they have all settled, so the
 * tileset's async metadata fetch and the query rows reach the merge together
 * and the saved layer finds its dataset. A tileset whose host is unreachable
 * settles as rejected, costing a kepler error notification and nothing else.
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
        datasets: [...toKeplerDatasets(datasets), ...restoredDatasets(savedConfig)],
        options: { centerMap },
        ...(config ? { config } : {}),
      })
    )
  );
}

/** kepler's `DatasetType.VECTOR_TILE`, the one type that needs the filter hint. */
const VECTOR_TILE_TYPE = 'vector-tile';
const VECTOR_TILE_FILTER_TYPES = [ALL_FIELD_TYPES.real, ALL_FIELD_TYPES.integer, ALL_FIELD_TYPES.boolean];

/** kepler's `DatasetType.RASTER_TILE`: a dataset that is a scene, not rows. */
const RASTER_TILE_TYPE = 'raster-tile';

/**
 * A raster scene in the shape kepler's own Add Data → Tileset produces.
 *
 * Copied from `modal-container`'s `_onTilesetAdded` and
 * `getDatasetAttributesFromRasterTile` on purpose: a dataset the panel builds
 * and one the user adds by hand end up in the same store, and any difference
 * between them would show up later as a raster that behaves subtly unlike its
 * neighbour.
 *
 * `rows: []` with `disableDataOperation` is the whole point of the shape — the
 * substance is `metadata`, and kepler fetches the STAC Item itself from
 * `metadataUrl` (`dataset-utils`' `refreshRasterTileMetadata`), so nothing here
 * has to know what a STAC Item looks like.
 *
 * The `rasterServer*` values are frozen into the dataset rather than read at
 * draw time, which is what kepler does: the dataset then keeps working if the
 * application config changes underneath it. `rasterServerUseLatestTitiler` is
 * the load-bearing one — it picks between two ways of writing the band index,
 * and TiTiler 2.x rejects the older one outright.
 */
function rasterProtoDataset(raster: RasterDataset) {
  return {
    info: { id: raster.id, label: raster.label, type: RASTER_TILE_TYPE, format: 'rows' },
    data: { fields: [], rows: [] },
    metadata: rasterMetadata(raster),
    disableDataOperation: true,
  } as unknown as ProtoDataset;
}

/**
 * The metadata that tells kepler how to fetch a raster's tiles.
 *
 * A PMTiles archive is declared and nothing else: `pmtilesType` is the flag
 * every branch inside kepler tests — `refreshRasterTileMetadata` reads the
 * archive's own header through `PMTilesSource` instead of fetching a STAC
 * document, and the layer builds a `PMTilesSource` rather than calling a
 * server. None of the `rasterServer*` settings apply to that path, and
 * carrying them would only suggest a server is involved.
 */
function rasterMetadata(raster: RasterDataset) {
  if (raster.kind === 'pmtiles') {
    return { metadataUrl: raster.metadataUrl, pmtilesType: PMTilesType.RASTER };
  }

  const appConfig = getApplicationConfig();
  return {
    metadataUrl: raster.metadataUrl,
    rasterTileServerUrls: raster.tileServerUrls,
    rasterServerUseLatestTitiler: appConfig.rasterServerUseLatestTitiler,
    rasterServerSupportsElevation: appConfig.rasterServerSupportsElevation,
    rasterServerMaxRetries: appConfig.rasterServerMaxRetries,
    rasterServerRetryDelay: appConfig.rasterServerRetryDelay,
    rasterServerServerErrorsToRetry: appConfig.rasterServerServerErrorsToRetry,
    rasterServerMaxPerServerRequests: appConfig.rasterServerMaxPerServerRequests,
  };
}

/**
 * Adds raster scenes to the map, one dataset and one layer each.
 *
 * Separate from `loadDatasets` rather than folded into its payload: a raster
 * carries no rows, and `processRowObject([])` returns null, so the row path
 * drops it on the floor without a word.
 *
 * `centerMap` defaults to false. A Sentinel granule is a hundred kilometres
 * across and framing the map to it would throw away wherever the user was
 * looking — and on a refresh, that is exactly the frame they are watching
 * change.
 */
export function loadRasters(dispatch: Dispatch, rasters: RasterDataset[], options: { centerMap?: boolean } = {}): void {
  if (rasters.length === 0) {
    return;
  }
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      updateVisData(rasters.map(rasterProtoDataset), {
        keepExistingConfig: true,
        centerMap: options.centerMap ?? false,
      })
    )
  );
}

/**
 * Refresh path for rasters: add what is new, swap what changed, drop what the
 * query stopped producing, and — the point of the exercise — leave alone what
 * did not change.
 *
 * The swap is `replaceDataInMap`, never `updateDatasetProps`. The latter exists,
 * accepts `metadata`, and is a trap twice over: it merges with `deepmerge`,
 * which *concatenates* arrays, so `bbox` would come back with eight numbers and
 * the band list would double; and `stac` is not in the layer's
 * `updateTriggers.getTileData`, so deck would go on serving the old tiles
 * regardless. `replaceDataInMap` rebuilds the dataset but rescues the
 * serialised layer config and re-merges it, so the layer keeps its id and
 * whatever the user styled on it.
 */
export function refreshRasters(store: Store, dispatch: Dispatch, rasters: RasterDataset[]): void {
  const { add, replace, remove } = splitRasterRefresh(rasters, readRasterDatasets(store));

  for (const id of remove) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, removeDataset(id)));
  }

  for (const raster of replace) {
    dispatch(
      wrapTo(
        KEPLER_INSTANCE_ID,
        replaceDataInMap({
          datasetToReplaceId: raster.id,
          datasetToUse: rasterProtoDataset(raster),
          // The payload of this whole phase: the default is `centerMap: true`,
          // and with it every change of the time range would yank the map back
          // to the granule's extent.
          options: { centerMap: false, keepExistingConfig: true },
        })
      )
    );
  }

  loadRasters(dispatch, add);
}

/** The raster datasets kepler holds, as the identity the refresh compares on. */
function readRasterDatasets(store: Store): Array<{ id: string; metadataUrl?: string }> {
  return Object.entries(getVisState(store)?.datasets ?? {})
    .filter(([, dataset]) => dataset.type === RASTER_TILE_TYPE)
    .map(([id, dataset]) => ({ id, metadataUrl: dataset.metadata?.metadataUrl }));
}

/**
 * Points a raster dataset at another scene, in place.
 *
 * The obvious way — `replaceDataInMap` — rebuilds the dataset, and with it the
 * layer: the map goes bare while the new tiles arrive, and the layer the user
 * had styled and named is replaced by a different one, which shows as a flicker
 * in the layer tree and as lost settings. Doing it in place avoids all three.
 *
 * Two dispatches. The first swaps the asset's `href` on the dataset, and only
 * that: `updateDatasetProps` deep-merges, and deep-merging *concatenates
 * arrays*, so touching `bbox` or the band list would silently double them. The
 * second changes `_stacQuery`, whose only role here is to be one of the values
 * in the layer's `updateTriggers.getTileData` — kepler reads `dataset.metadata`
 * afresh on every render, but deck will not refetch tiles until a trigger
 * changes. It is unused while STAC searching is off, which is the only reason
 * it is free to borrow; `useSTACSearching` layers keep the old path.
 *
 * What stays behind is the rest of the metadata — extent, band statistics — from
 * the scene the dataset was created with. For a series of one product on one
 * grid that is exactly right. It would not be for scenes of differing extent.
 *
 * Returns false when the swap cannot be made in place, so the caller can fall
 * back to the rebuild.
 */
export function swapRasterScene(store: Store, dispatch: Dispatch, raster: RasterDataset): boolean {
  // An archive cannot be swapped in place, and the reason is in deck rather
  // than here. kepler's PMTiles branch declares `updateTriggers.getTileData:
  // [shouldLoadTerrain]` and nothing else (`raster-tile-layer`'s
  // `renderPMTilesLayer`), so no change this module can make to the dataset
  // tells deck that its tiles have expired: it builds the new tile source,
  // reads its header, and goes on drawing the tiles of the first archive.
  // Measured, not assumed — every date drew the same rain. The COG branch
  // lists `_stacQuery` among its triggers, which is the whole reason the swap
  // below works there. So an archive takes the rebuild instead, which costs a
  // new tile source and buys a scene that actually changes.
  if (raster.kind === 'pmtiles') {
    return false;
  }

  const visState = getVisState(store);
  const dataset = visState?.datasets[raster.id];
  const layer = visState?.layers.find((candidate) => candidate.config?.dataId === raster.id);
  if (!dataset || !layer) {
    return false;
  }
  if (layer.config?.visConfig?.useSTACSearching) {
    return false;
  }

  // Which asset carries the imagery is the STAC's business, not ours: read the
  // key back rather than assuming the one TiTiler happens to emit.
  const assets = (dataset.metadata as { assets?: Record<string, { href?: string }> } | undefined)?.assets ?? {};
  const assetId = Object.keys(assets).find((key) => typeof assets[key]?.href === 'string');
  if (!assetId) {
    return false;
  }

  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      updateDatasetProps(raster.id, { metadata: { assets: { [assetId]: { href: raster.sourceUrl } } } })
    )
  );
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      layerVisConfigChange(layer as unknown as Parameters<typeof layerVisConfigChange>[0], {
        _stacQuery: raster.sourceUrl,
      })
    )
  );
  return true;
}


/**
 * Shows or hides a raster layer without touching its dataset.
 *
 * The alternative — dropping the dataset when there is nothing to draw — takes
 * the layer with it, and the one rebuilt afterwards is a different layer with
 * default styling. Playback makes that constant: wrapping from the end of the
 * timeline to the start crosses a window with no scene in it, so every lap
 * threw away whatever the user had named, coloured or faded. Hidden layers come
 * back exactly as they were.
 *
 * Returns false when there is no such layer yet, so the caller can try again.
 */
export function setRasterLayerVisible(store: Store, dispatch: Dispatch, dataId: string, visible: boolean): boolean {
  const layer = getVisState(store)?.layers.find((candidate) => candidate.config?.dataId === dataId);
  if (!layer) {
    return false;
  }
  if (layer.config?.isVisible === visible) {
    return true;
  }
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      layerConfigChange(layer as unknown as Parameters<typeof layerConfigChange>[0], { isVisible: visible })
    )
  );
  return true;
}

/**
 * Copies styling onto the raster layer of a dataset, if that layer exists yet.
 *
 * kepler creates the layer asynchronously, so this is called again on each
 * store change until it finds one — and reports whether it did, so the caller
 * knows when to stop asking.
 */
export function applyRasterStyle(
  store: Store,
  dispatch: Dispatch,
  dataId: string,
  style: Record<string, unknown>
): boolean {
  return applyLayerVisConfig(store, dispatch, dataId, style);
}

/**
 * Merges values into the `visConfig` of whatever layer draws a dataset.
 *
 * A `visConfig` change is the one way to tell kepler that a layer's data has to
 * be recomputed without touching the dataset, which is why both the raster's
 * colour ramp and the WMS layer's date and layer name travel this way.
 *
 * Returns false when there is no such layer yet, so a caller polling for one
 * knows to ask again.
 */
export function applyLayerVisConfig(
  store: Store,
  dispatch: Dispatch,
  dataId: string,
  visConfig: Record<string, unknown>
): boolean {
  const layer = getVisState(store)?.layers.find((candidate) => candidate.config?.dataId === dataId);
  if (!layer) {
    return false;
  }
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      // The layer object is kepler's own; only this module's view of it is
      // narrowed, hence the cast.
      layerVisConfigChange(layer as unknown as Parameters<typeof layerVisConfigChange>[0], visConfig)
    )
  );
  return true;
}

/** kepler's `DatasetType.WMS_TILE`: a dataset that is a service, not rows. */
const WMS_TILE_TYPE = 'wms-tile';

/**
 * A WMS layer in the shape kepler's own Add Data -> Tileset -> WMS produces.
 *
 * `layers` is supplied with the one layer the query named, and that is only a
 * bootstrap: `createTable` merges what the capabilities refresh returns *over*
 * this metadata, so moments later it holds every layer the service publishes
 * and `findDefaultLayerProps` would have picked the first of them. Which layer
 * is actually drawn is settled afterwards, by `applyWmsLayerChoice`.
 *
 * `tilesetDataUrl` is the bare endpoint. Everything else — the date included —
 * is built from it at request time, and a query string here would corrupt every
 * request built on it; `serviceUrlOf` is what guarantees it is bare.
 */
function wmsProtoDataset(wms: WmsDataset) {
  return {
    info: { id: wms.id, label: wms.label, type: WMS_TILE_TYPE, format: 'rows' },
    data: { fields: [], rows: [] },
    metadata: {
      type: REMOTE_TILE,
      remoteTileFormat: RemoteTileFormat.WMS,
      tilesetDataUrl: wms.serviceUrl,
      tilesetMetadataUrl: `${wms.serviceUrl}?service=WMS&request=GetCapabilities`,
      layers: [{ name: wms.layerName, title: wms.layerName, boundingBox: null, queryable: true }],
      version: '1.3.0',
    },
    disableDataOperation: true,
  } as unknown as ProtoDataset;
}

/**
 * Adds WMS layers to the map, one dataset and one layer each.
 *
 * Separate from `loadDatasets` for the same reason as `loadRasters`: no rows.
 * `centerMap` defaults to false — a WMS covers a country or a continent, and
 * framing the map to it would throw away wherever the user was looking.
 */
export function loadWms(dispatch: Dispatch, layers: WmsDataset[], options: { centerMap?: boolean } = {}): void {
  if (layers.length === 0) {
    return;
  }
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      updateVisData(layers.map(wmsProtoDataset), {
        keepExistingConfig: true,
        centerMap: options.centerMap ?? false,
      })
    )
  );
}

/**
 * Refresh path for WMS layers: add, rebuild, drop, and leave the rest alone.
 *
 * Rebuilding is rare by design. The date never comes through here — it is a
 * `visConfig` change on the layer — so the only things that reach this path are
 * a query that starts naming a different service or layer, and one that stops
 * naming any. That matters because a rebuild costs a fresh GetCapabilities, and
 * on a service like GeoGLOWS that is the better part of a megabyte of XML.
 */
export function refreshWms(store: Store, dispatch: Dispatch, layers: WmsDataset[]): void {
  const { add, replace, remove } = splitWmsRefresh(layers, readWmsDatasets(store));

  for (const id of remove) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, removeDataset(id)));
  }

  for (const wms of replace) {
    dispatch(
      wrapTo(
        KEPLER_INSTANCE_ID,
        replaceDataInMap({
          datasetToReplaceId: wms.id,
          datasetToUse: wmsProtoDataset(wms),
          options: { centerMap: false, keepExistingConfig: true },
        })
      )
    );
  }

  loadWms(dispatch, add);
}

/** The WMS datasets kepler holds, as the identity the refresh compares on. */
function readWmsDatasets(store: Store): Array<{ id: string; serviceUrl?: string; layerName?: string }> {
  const visState = getVisState(store);
  return Object.entries(visState?.datasets ?? {})
    .filter(([, dataset]) => dataset.type === WMS_TILE_TYPE)
    .map(([id, dataset]) => {
      const metadata = dataset.metadata as { tilesetDataUrl?: string } | undefined;
      const layer = visState?.layers.find((candidate) => candidate.config?.dataId === id);
      const chosen = layer?.config?.visConfig?.wmsLayer as { name?: string } | undefined;
      return { id, serviceUrl: metadata?.tilesetDataUrl, layerName: chosen?.name };
    });
}

/**
 * Pins the layer of the service that should actually be drawn.
 *
 * Needed because kepler's own metadata refresh overwrites the single-layer list
 * the panel supplied with every layer the service publishes, and the layer was
 * built from `layers[0]` of whichever list arrived first. On the GeoGLOWS
 * service that is `imerg_early_run_24h`, whatever the query asked for.
 *
 * `boundingBox` is left null and `queryable` true: the values that matter come
 * from the capabilities document, and overwriting them with guesses would trade
 * a wrong layer for a wrong extent.
 */
export function applyWmsLayerChoice(store: Store, dispatch: Dispatch, wms: WmsDataset): boolean {
  const layer = getVisState(store)?.layers.find((candidate) => candidate.config?.dataId === wms.id);
  if (!layer) {
    return false;
  }

  const known = (getVisState(store)?.datasets[wms.id]?.metadata as { layers?: WmsServiceLayer[] } | undefined)?.layers;
  const chosen = known?.find((candidate) => candidate.name === wms.layerName) ?? {
    name: wms.layerName,
    title: wms.layerName,
    boundingBox: null,
    queryable: true,
  };

  const current = layer.config?.visConfig?.wmsLayer as { name?: string } | undefined;
  if (current?.name === chosen.name) {
    return true;
  }
  return applyLayerVisConfig(store, dispatch, wms.id, { wmsLayer: chosen });
}

/** One entry of a WMS dataset's layer list, as kepler stores it. */
interface WmsServiceLayer {
  name: string;
  title: string;
  boundingBox: number[] | null;
  queryable?: boolean;
}

/**
 * The dataset that gives a WMS timeline its clock.
 *
 * kepler's time filter is always a filter *on a column of a dataset*: there is
 * no such thing as a free-standing time axis. So when the dates come from the
 * service rather than from the query — the query named a layer and nothing else
 * — there is nothing on the map for the widget to attach to, and the timeline
 * simply never appears.
 *
 * This makes one: a dataset of a single `time` column, one row per date the
 * service publishes. It is also honest content in its own right, and shows up
 * in kepler's data table as the calendar it is.
 *
 * The fingerprint in `metadata` is what makes this idempotent. The hook that
 * calls this runs on every store change, and rebuilding the calendar each time
 * would reset the very filter it exists to feed. Comparing the dates
 * themselves, rather than the identity of the array holding them, means a
 * re-query that returns the same calendar changes nothing.
 */
export function syncWmsCalendar(store: Store, dispatch: Dispatch, wms: WmsDataset): void {
  syncCalendarDataset(store, dispatch, {
    id: wmsCalendarDatasetId(wms.id),
    label: wms.label,
    times: wms.times,
  });
}

/**
 * Puts a calendar of dates on the map as a dataset of rows.
 *
 * Shared by the WMS and Zarr paths, and shared rather than copied because what
 * they need here is identical down to the fingerprint: neither carries rows of
 * its own, kepler's time filter can only hang off a column, and both are
 * reconciled from a hook that runs on every store change. The two `split*Refresh`
 * functions stay apart because what makes two layers *the same layer* differs
 * between them; nothing differs here.
 */
export function syncCalendarDataset(
  store: Store,
  dispatch: Dispatch,
  calendar: { id: string; label: string; times: number[] }
): void {
  if (calendar.times.length === 0) {
    return;
  }

  const { id, times } = calendar;
  const fingerprint = `${times.length}|${times[0]}|${times[times.length - 1]}`;
  const existing = getVisState(store)?.datasets[id];
  if (existing) {
    const held = (existing.metadata as { calendarFingerprint?: string } | undefined)?.calendarFingerprint;
    if (held === fingerprint) {
      return;
    }
  }

  const data = processRowObject(times.map((time) => ({ time })));
  if (!data) {
    return;
  }
  const proto = {
    info: { id, label: `${calendar.label} · dates`, format: 'row' },
    data,
    metadata: { calendarFingerprint: fingerprint },
  } as unknown as ProtoDataset;

  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      existing
        ? replaceDataInMap({
            datasetToReplaceId: id,
            datasetToUse: proto,
            options: { centerMap: false, keepExistingConfig: true },
          })
        : updateVisData([proto], { keepExistingConfig: true, centerMap: false })
    )
  );
}

/**
 * Points a WMS layer at a moment.
 *
 * One dispatch, and no dataset is touched at all: the date lands in the layer's
 * `visConfig`, `wmsTimeLayer` reads it there on the next render, and deck sees a
 * data url it has not seen before. Nothing is rebuilt, nothing is refetched
 * except the picture itself, and the layer the user styled is the same layer
 * before and after.
 *
 * Quiet when the layer already shows that moment, which is most of the time: a
 * drag of the time widget that stays between two dates arrives here and stops.
 */
export function applyWmsTime(store: Store, dispatch: Dispatch, dataId: string, time: string): boolean {
  const layer = getVisState(store)?.layers.find((candidate) => candidate.config?.dataId === dataId);
  if (!layer) {
    return false;
  }
  if (layer.config?.visConfig?.wmsTime === time) {
    return true;
  }
  return applyLayerVisConfig(store, dispatch, dataId, { wmsTime: time });
}

/**
 * The URL-backed datasets a saved config carries, ready for `addDataToMap`.
 *
 * `supportedFilterTypes` is re-attached rather than restored: kepler's
 * `DatasetSchema` does not save the field, but the tileset modal
 * (`modal-container`'s `_onTilesetAdded`) sets it when the dataset is added,
 * because a vector tile layer filters on the GPU and only handles numeric and
 * boolean columns. Without it kepler's filter field picker offers every column,
 * including ones the filter cannot act on.
 */
export function restoredDatasets(savedConfig?: SavedMapConfig | null): ProtoDataset[] {
  return (savedConfig?.datasets ?? []).map((saved) => {
    const parsed = datasetSchema[VERSIONS.v1].load(saved.data as SavedDatasetV1['data']);
    return saved.data.type === VECTOR_TILE_TYPE
      ? { ...parsed, supportedFilterTypes: VECTOR_TILE_FILTER_TYPES }
      : parsed;
  });
}

/**
 * Snapshots the current map configuration — layers, filters, interactions, base
 * map — so it can be stored in the panel options.
 *
 * Also captures the datasets kepler holds by URL rather than by rows: the
 * tilesets added through kepler's own Add Data. They exist nowhere but in
 * kepler's store, so a config that named their layers without them came back
 * pointing at nothing. Everything else — the panel's query datasets, a file
 * dropped into Add Data — is deliberately left out: the queries rebuild their
 * own, and a dropped file's rows have no business in the dashboard JSON.
 *
 * Serialised one at a time rather than through `KeplerGlSchema.getDatasetToSave`,
 * which flattens *every* dataset — the whole query result included — only for
 * this to throw the result away.
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
  const config = KeplerGlSchema.getConfigToSave(instance) as unknown as SavedMapConfig;
  const datasets = captureRemoteDatasets(store);
  return datasets.length > 0 ? { ...config, datasets } : config;
}

/** The saved form of every URL-backed dataset the map currently holds. */
function captureRemoteDatasets(store: Store): SavedRemoteDataset[] {
  const datasets = Object.entries(getVisState(store)?.datasets ?? {});
  // Called as a method: `DatasetSchema.save` reads `this.key`, so it cannot be
  // detached from the schema object.
  const schema = datasetSchema[VERSIONS.v1];
  const saved = datasets
    .filter(([, dataset]) => REMOTE_DATASET_TYPES.includes(dataset.type ?? ''))
    // Not the ones the panel mints from a query. They are remote datasets like
    // any other, but the query rebuilds them on every load, so saving them
    // writes a second dataset with the same id into the dashboard JSON — and
    // the stale copy would then race the fresh one on the next load. Same
    // reasoning the comment above gives for leaving the row datasets out.
    .filter(([id]) => !isPanelRasterId(id) && !isPanelWmsId(id))
    .map(([, dataset]) => ({
      version: VERSIONS.v1,
      // The state object is kepler's own `KeplerTable`; only this module's view
      // of it is narrowed, hence the cast.
      data: schema.save(dataset as unknown as Parameters<typeof schema.save>[0]),
    }));
  // Back through the same filter the import path uses, so what a save writes and
  // what a paste accepts can never drift apart.
  return keepRemoteDatasets(saved);
}

/**
 * Refresh path: replaces the data behind existing datasets while preserving the
 * layers, filters and styling the user configured by hand.
 *
 * This is the deliberate departure from the Foursquare plugin, which does
 * removeDataset + addDataset on every refresh and therefore discards the user's
 * layer configuration each time the query re-runs.
 *
 * Datasets kepler already holds go through `replaceDataInMap`, one call each,
 * because `updateVisData` cannot swap their rows — see `replaceDatasetData`
 * below, and `splitRefresh` for why. Only genuinely new ones — a query that
 * gained a refId — take the `updateVisData` path, which is the one that can
 * create a dataset.
 */
export function refreshDatasets(store: Store, dispatch: Dispatch, datasets: PanelDataset[]): void {
  const { replace, add } = splitRefresh(datasets, readDatasetIds(store));

  for (const dataset of replace) {
    replaceDatasetData(dispatch, dataset);
  }

  if (add.length === 0) {
    return;
  }

  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      updateVisData(toKeplerDatasets(add), {
        keepExistingConfig: true,
        // Re-framing the viewport on every refresh would fight the user panning.
        centerMap: false,
      })
    )
  );
}

/** The dataset ids kepler is currently holding. */
function readDatasetIds(store: Store): string[] {
  return Object.keys(getVisState(store)?.datasets ?? {});
}

/**
 * Swaps the rows behind one dataset, keeping the layers built on it.
 *
 * `updateVisData` cannot do this. For an id it already knows, kepler takes the
 * "update the data when loading data by batches incrementally" path in
 * `createNewDataEntry`, which is meant for streaming a dataset in pieces. That
 * path ends at `KeplerTable.update`, which calls `this.dataContainer.update?.()`
 * — and `RowDataContainer`, which is what a `{fields, rows}` dataset gets, has
 * no `update` at all. The optional chaining swallows the call and the old rows
 * stay. Confirmed on the live container, whose whole prototype is `numRows`,
 * `valueAt`, `row`, `column`, `map`, `find` and friends.
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
  datasets: Record<
    string,
    {
      fields: Array<{ name: string; type?: string }>;
      dataContainer?: unknown;
      /** kepler's `DatasetType`: '' for a dataset built from rows, 'vector-tile' and friends for a URL. */
      type?: string;
      /** Where a URL-backed dataset points; for a raster, which scene it is. */
      metadata?: { metadataUrl?: string };
    }
  >;
  layers: Array<{
    id: string;
    type?: string;
    config?: {
      dataId?: string;
      isVisible?: boolean;
      visConfig?: { useSTACSearching?: boolean; wmsLayer?: unknown; wmsTime?: unknown; zarrLabel?: unknown };
    };
    meta?: { bounds?: number[] };
    /** Resolves a picked deck.gl object to its row — what the tooltip uses. */
    getHoverData?: (
      object: unknown,
      dataContainer: unknown,
      fields: Array<{ name: string }>,
      animationConfig: unknown,
      hoverInfo: unknown
    ) => unknown;
  }>;
  /**
   * The deck.gl picking info of the entity last clicked, stored verbatim by
   * `layerClickUpdater`. `null` is the user's deselect (empty-map click or
   * closing the popover); `undefined` is no state — initial, or reset by the
   * system when a refresh removes and re-merges the clicked layer.
   */
  clicked?: {
    picked?: boolean;
    object?: unknown;
    index?: number;
    layer?: { props?: { idx?: number } };
  } | null;
  animationConfig?: {
    currentTime?: number | null;
    domain?: number[] | null;
    /** True while the trip playback is running. */
    isAnimating?: boolean;
  };
  /** kepler's draw editor: finished figures not (yet) bound to a polygon filter. */
  editor?: {
    features?: Array<{ id?: string | number; geometry?: { type?: string; coordinates?: unknown } }>;
  };
  /**
   * The mouse-position tracking behind kepler's coordinate interaction.
   * `pinned` is where a click froze it: `layerClickUpdater` toggles it — a
   * clone of the tracked position on one click, back to `null` on the next.
   * The object itself is rebuilt on every mouse move but `pinned` travels by
   * reference, so its identity moves exactly on a pin or unpin.
   */
  mousePos?: {
    pinned?: { coordinate?: unknown } | null;
  };
  /** kepler's per-interaction switches; `coordinate` is the one the pin needs. */
  interactionConfig?: {
    coordinate?: { enabled?: boolean };
  };
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
 * whether there is yet a time column to bind to, the animation config holds the
 * trip playhead, and the editor holds the drawn figures the area sync
 * publishes — between them that is everything the sync hooks look at. kepler's
 * `setFeaturesUpdater` rebuilds the whole `editor` object on every change, so
 * its identity moves exactly when a figure does. Panning the map, hovering a
 * point and opening a panel touch none of the four, so their identity stays put
 * and the reconcile is skipped. See {@link SliceWatcher}.
 */
export function readSyncSlices(store: Store): unknown[] {
  const visState = getVisState(store);
  return visState ? [visState.filters, visState.datasets, visState.animationConfig, visState.editor] : [];
}

/** A figure drawn on the map, wherever kepler is keeping it. */
export interface DrawnArea {
  /** kepler's feature id — assigned once when the figure is finished, stable across vertex edits. */
  id: string;
  geometry: { type: string; coordinates?: unknown };
}

/**
 * Every figure drawn on the map, from both places kepler keeps them: polygon
 * filters (`type: 'polygon'`, whose `value` is the whole GeoJSON Feature — a
 * rectangle is applied to every layer the moment it is finished) and
 * `editor.features` (a finished polygon waits there until a layer is chosen;
 * kepler removes it from the editor once it becomes a filter).
 *
 * Deduped by feature id keeping the first occurrence; filters come first and
 * editor features last, so "the last element" is a deterministic notion of the
 * most recent figure that `areaSync` relies on.
 */
export function readDrawnAreas(store: Store): DrawnArea[] {
  const visState = getVisState(store);
  if (!visState) {
    return [];
  }

  const candidates: Array<{ id?: string | number; geometry?: { type?: string; coordinates?: unknown } }> = [];
  for (const filter of visState.filters) {
    if (filter.type === 'polygon') {
      const feature = filter.value as { id?: string | number; geometry?: { type?: string; coordinates?: unknown } };
      if (feature && typeof feature === 'object') {
        candidates.push(feature);
      }
    }
  }
  candidates.push(...(visState.editor?.features ?? []));

  const seen = new Set<string>();
  const areas: DrawnArea[] = [];
  for (const { id, geometry } of candidates) {
    const key = typeof id === 'number' ? String(id) : id;
    if (!key || seen.has(key) || !geometry?.type) {
      continue;
    }
    seen.add(key);
    areas.push({ id: key, geometry: { type: geometry.type, coordinates: geometry.coordinates } });
  }
  return areas;
}

/**
 * The vis-state slice the click sync watches: just `clicked`, whose identity
 * moves exactly on a click (or its reset). Kept apart from `readSyncSlices` so
 * a click does not wake the filter and area reconciles, nor a filter change
 * the click one.
 */
export function readClickSlices(store: Store): unknown[] {
  const visState = getVisState(store);
  return visState ? [visState.clicked] : [];
}

/**
 * The mapped column values of the entity last clicked on the map.
 *
 * Returns the tri-state `clickSync.ts` decides over: an object of resolved
 * values for a clicked entity, `null` for the user's deselect, `undefined` for
 * no click state. A click this cannot resolve — no layer index, a layer with
 * no dataset — is `undefined` too: it is not a deselect, and must not clear.
 *
 * Resolution is kepler's own tooltip path (`getLayerHoverData` in
 * `layer-utils`): deck's picking info names the kepler layer by `props.idx`,
 * and the layer's `getHoverData` turns the picked object into a row of its
 * dataset. That is what makes this uniform across layer types — a point's row,
 * a trajectory's row in a geojson-mode trip layer, the vertex under the
 * playhead in a table-mode one.
 *
 * The fallback covers table-mode trip layers only: their `getHoverData` finds
 * the vertex at the *current animation time*, which is null when the playhead
 * sits outside the clicked trip's window (a fading trail is still clickable).
 * The feature's rows all share the identity columns — the feature exists
 * because they were grouped by trip id — so the first row answers for the
 * trip.
 */
export function readClickedEntity(store: Store, fields: string[]): Record<string, unknown> | null | undefined {
  const visState = getVisState(store);
  if (!visState) {
    return undefined;
  }
  // While the draw toolbar is engaged, map clicks place or edit vertices.
  // kepler consumes them before they reach the layers, but that interception
  // is not contractual (the map-click spike saw LAYER_CLICKs leak through), so
  // any click state during a draw is "no state" — never a selection or a
  // deselect someone drew by accident.
  if (isDrawActive(store)) {
    return undefined;
  }
  const clicked = visState.clicked;
  if (clicked === undefined) {
    return undefined;
  }
  if (clicked === null) {
    return null;
  }

  // A WMS click never resolves through a dataset: the values came from the
  // service, not from any row the panel holds, and the dataset kepler binds the
  // layer to has no fields at all. Answered here, before the row path that
  // would find nothing and read as "not a selection".
  const fromService = wmsFeatureValues(clicked.object);
  if (fromService) {
    const asked: Record<string, unknown> = {};
    for (const field of fields) {
      if (fromService[field] !== undefined) {
        asked[field] = fromService[field];
      }
    }
    return asked;
  }

  const layerIdx = clicked.layer?.props?.idx;
  const layer = typeof layerIdx === 'number' ? (visState.layers ?? [])[layerIdx] : undefined;
  const dataId = layer?.config?.dataId;
  const dataset = dataId ? visState.datasets[dataId] : undefined;
  if (!layer?.getHoverData || !dataset) {
    return undefined;
  }

  // `object ?? index`: binary-format geojson layers pick with a null object
  // and the row index instead, same contract as kepler's `getLayerHoverProp`.
  const row = layer.getHoverData(
    clicked.object ?? clicked.index,
    dataset.dataContainer,
    dataset.fields,
    visState.animationConfig,
    clicked
  );
  const fallback = firstFeatureRow(clicked.object);

  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const fieldIdx = dataset.fields.findIndex((f) => f.name === field);
    if (fieldIdx < 0) {
      continue;
    }
    const value = rowFieldValue(row, fieldIdx) ?? rowFieldValue(fallback, fieldIdx);
    if (value !== undefined && value !== null) {
      values[field] = value;
    }
  }
  return values;
}

/** A table-mode trip feature's first vertex row, if the object is one. */
function firstFeatureRow(object: unknown): unknown {
  const feature = object as { properties?: { values?: unknown[] } } | null | undefined;
  const values = feature?.properties?.values;
  return Array.isArray(values) ? values[0] : undefined;
}

/**
 * The vis-state slices the coordinate sync watches: the pin, whose identity
 * moves exactly on a pin or unpin (see `VisStateLike.mousePos`), and the
 * interaction config, so restoring a saved map configuration — which can
 * switch the coordinate interaction back off — wakes the hook to re-enable
 * it. Mouse moves rebuild `mousePos` but not `pinned`, so they stay quiet.
 */
export function readCoordinateSlices(store: Store): unknown[] {
  const visState = getVisState(store);
  return visState ? [visState.mousePos?.pinned, visState.interactionConfig] : [];
}

/**
 * The map coordinate the user last pinned, as kepler's `[lng, lat]`.
 *
 * The tri-state `coordinateSync.ts` decides over: a pair for a pinned spot,
 * `null` for the unpin of kepler's toggle, `undefined` for no state at all.
 * Same draw guard as `readClickedEntity`, and for the same reason: while the
 * draw toolbar is engaged, map clicks place vertices, and kepler's own
 * interception of them is not contractual.
 */
export function readPinnedCoordinate(store: Store): [number, number] | null | undefined {
  const visState = getVisState(store);
  if (!visState || isDrawActive(store)) {
    return undefined;
  }
  const pinned = visState.mousePos?.pinned;
  if (pinned === undefined) {
    return undefined;
  }
  if (pinned === null) {
    return null;
  }
  const coordinate = pinned.coordinate;
  if (!Array.isArray(coordinate) || coordinate.length < 2) {
    return undefined;
  }
  const [lng, lat] = coordinate;
  return typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : undefined;
}

/**
 * Switches kepler's coordinate interaction on, so clicks pin a coordinate at
 * all — it ships disabled, and nothing else in the panel turns it on.
 *
 * Idempotent, so the caller can re-run it on every reconcile: restoring a
 * saved map configuration replaces `interactionConfig` wholesale, and a
 * config saved before the coordinate mapping existed would switch the
 * interaction back off. Returns false while the map has no vis-state yet,
 * same contract as `pushTimeRange`.
 */
export function ensureCoordinateInteraction(store: Store, dispatch: Dispatch): boolean {
  const coordinate = getVisState(store)?.interactionConfig?.coordinate;
  if (!coordinate) {
    return false;
  }
  if (!coordinate.enabled) {
    // The state object is kepler's full interaction config; only this module's
    // view of it is narrowed, hence the cast.
    const config = { ...coordinate, enabled: true } as Parameters<typeof interactionConfigChange>[0];
    dispatch(wrapTo(KEPLER_INSTANCE_ID, interactionConfigChange(config)));
  }
  return true;
}

/** Whether kepler's draw toolbar is engaged, so map clicks belong to it. */
function isDrawActive(store: Store): boolean {
  const state = store.getState() as {
    keplerGl?: Record<string, { uiState?: { mapControls?: { mapDraw?: { active?: boolean } } } }>;
  };
  return Boolean(state.keplerGl?.[KEPLER_INSTANCE_ID]?.uiState?.mapControls?.mapDraw?.active);
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
 *
 * Returns false when there is nothing to filter on yet — no map state, or no
 * loaded dataset carrying the column — the same contract as `pushTimeRange`. The
 * caller must not record the field as synced on a false, or the next reconcile
 * reads the map's missing filter as a deliberate clearing and publishes it back
 * over the variable that was driving.
 */
export function applyFieldFilter(store: Store, dispatch: Dispatch, field: string, values: string[]): boolean {
  return applyFilterValue(store, dispatch, field, values);
}

/**
 * Sets a numeric range filter on `field` to `pair` — the variable → map
 * direction of a range mapping.
 *
 * Same contract as {@link applyFieldFilter}. kepler infers the filter type
 * from the column, so on a numeric column the created filter is a `range` and
 * the pair lands as its window.
 */
export function applyRangeFilter(store: Store, dispatch: Dispatch, field: string, pair: [number, number]): boolean {
  return applyFilterValue(store, dispatch, field, pair);
}

function applyFilterValue(store: Store, dispatch: Dispatch, field: string, value: unknown): boolean {
  const visState = getVisState(store);
  if (!visState) {
    return false;
  }

  const existing = visState.filters.find((f) => filterHasField(f, field));
  if (existing) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(existing.id, undefined, undefined, value)));
    return true;
  }

  for (const [dataId, dataset] of Object.entries(visState.datasets)) {
    if (dataset.fields.some((f) => f.name === field)) {
      dispatch(wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(undefined, dataId, field, value)));
      return true;
    }
  }

  return false;
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

/** The id of the base map style the map is currently showing. */
export function readBasemapId(store: Store): string | null {
  const state = store.getState() as { keplerGl?: Record<string, { mapStyle?: { styleType?: string } }> };
  return state.keplerGl?.[KEPLER_INSTANCE_ID]?.mapStyle?.styleType ?? null;
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

/** Whether the trip animation is currently playing. */
export function readIsAnimating(store: Store): boolean {
  return Boolean(getVisState(store)?.animationConfig?.isAnimating);
}

/**
 * Puts the trip animation back into play, if it is not already.
 *
 * Replacing a dataset stops it: while the swap is in flight there is a moment
 * with no animatable layer, and `updateAnimationDomain` sets `isAnimating: false`
 * whenever it finds none (`vis-state-updaters.js:3243-3255`). Without this, every
 * pan or zoom during playback would silently leave the map paused.
 */
export function resumeAnimation(store: Store, dispatch: Dispatch): void {
  if (!readIsAnimating(store)) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, toggleLayerAnimation()));
  }
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

/**
 * The bbox of what the map is currently showing, or null before its layout
 * has settled — kepler reports a zero-sized map until then.
 *
 * Derived from centre, zoom and pixel size by the same Mercator arithmetic
 * the wind field uses; `viewportFromMapState` carries the extra pixel
 * dimensions that tracer needs, and this drops them.
 */
export function readViewportBounds(store: Store): ViewportBounds | null {
  const viewport = viewportFromMapState(readMapState(store));
  return viewport ? { west: viewport.west, south: viewport.south, east: viewport.east, north: viewport.north } : null;
}

/**
 * The union of every layer's data bounds, or null when no layer has any.
 *
 * What the load-window viewport guard fits a config-less map back to when
 * kepler's internal view state echo undoes the centre-on-data of the load.
 */
export function readLayerBoundsUnion(store: Store): MapBounds | null {
  let union: MapBounds | null = null;
  for (const layer of getVisState(store)?.layers ?? []) {
    const bounds = layer.meta?.bounds;
    if (!Array.isArray(bounds) || bounds.length !== 4) {
      continue;
    }
    const b = bounds as MapBounds;
    union = union
      ? [Math.min(union[0], b[0]), Math.min(union[1], b[1]), Math.max(union[2], b[2]), Math.max(union[3], b[3])]
      : b;
  }
  return union;
}

/**
 * Puts a full saved viewport back on the map — latitude, longitude, zoom and
 * whatever bearing/pitch the config carried. The viewport guard's restore.
 */
export function restoreViewport(
  store: Store,
  dispatch: Dispatch,
  viewport: { latitude: number; longitude: number; zoom: number; bearing?: number; pitch?: number }
): boolean {
  if (!getVisState(store)) {
    return false;
  }
  dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap(viewport as Parameters<typeof updateMap>[0], 0)));
  return true;
}

/**
 * Centres the map on a coordinate — the read-back direction of the centre
 * mapping. Without `zoom` the map keeps the zoom it has, so centring never
 * costs the user the scale they chose. Returns false while the map has no
 * state yet, same contract as `pushTimeRange`.
 */
export function centerMapOn(store: Store, dispatch: Dispatch, lat: number, lng: number, zoom?: number): boolean {
  if (!getVisState(store)) {
    return false;
  }
  const viewport = { latitude: lat, longitude: lng, ...(typeof zoom === 'number' ? { zoom } : {}) };
  dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap(viewport as Parameters<typeof updateMap>[0], 0)));
  return true;
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

/**
 * The dataset type the panel mints for a Zarr variable.
 *
 * Not one of kepler's own — `DatasetType` knows local, vector-tile,
 * raster-tile, wms-tile, tile-3d and bitmap, and none of them describes a store
 * of named arrays rendered on demand. Making one up is safe because the only
 * code that asks is `matchDatasetType`, which compares strings, and
 * `refreshRemoteData` falls through to `null` for a type it does not recognise —
 * so kepler will not try to refresh metadata the panel owns.
 */
const ZARR_TILE_TYPE = 'zarr';

/**
 * A Zarr variable in the shape the panel's own layer reads.
 *
 * Everything the layer needs to build a tile url lives in `metadata`, because
 * that is what survives kepler's dataset machinery untouched: there are no rows
 * here, and no upstream code that would rewrite these keys the way the WMS
 * capabilities refresh rewrites `layers`.
 *
 * The server travels with the dataset rather than being read at draw time, for
 * the reason the raster path gives: two panels on one dashboard may render from
 * different TiTilers, and a dataset that reads a global at draw time cannot.
 */
function zarrProtoDataset(zarr: ZarrDataset) {
  return {
    info: { id: zarr.id, label: zarr.label, type: ZARR_TILE_TYPE, format: 'rows' },
    data: { fields: [], rows: [] },
    metadata: {
      serverUrl: zarr.serverUrl,
      storeUrl: zarr.storeUrl,
      variable: zarr.variable,
      selectors: zarr.selectors,
      levels: zarr.levels,
      dimension: zarr.dimension,
      colormap: zarr.colormap,
      rescale: zarr.rescale,
    },
    disableDataOperation: true,
  } as unknown as ProtoDataset;
}

/**
 * Adds Zarr variables to the map, one dataset and one layer each.
 *
 * Separate from `loadDatasets` for the reason `loadRasters` and `loadWms` are:
 * no rows, and `processRowObject([])` returns null, so the row path drops it
 * without a word.
 *
 * `centerMap` defaults to false. A climate store is global, and framing the map
 * to it would throw away wherever the user was looking — and pull a great many
 * tiles from a server that makes each one from scratch.
 */
export function loadZarr(dispatch: Dispatch, layers: ZarrDataset[], options: { centerMap?: boolean } = {}): void {
  if (layers.length === 0) {
    return;
  }
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      updateVisData(layers.map(zarrProtoDataset), {
        keepExistingConfig: true,
        centerMap: options.centerMap ?? false,
      })
    )
  );
}

/**
 * Refresh path for Zarr variables: add, rebuild, drop, leave the rest alone.
 *
 * Rebuilding is rare by design, and the moment never reaches here — it is a
 * `visConfig` change on the layer. What does reach here is a query that starts
 * naming a different store or variable, and one that stops naming any.
 */
export function refreshZarr(store: Store, dispatch: Dispatch, layers: ZarrDataset[]): void {
  const { add, replace, remove } = splitZarrRefresh(layers, readZarrDatasets(store));

  for (const id of remove) {
    dispatch(wrapTo(KEPLER_INSTANCE_ID, removeDataset(id)));
  }

  for (const zarr of replace) {
    dispatch(
      wrapTo(
        KEPLER_INSTANCE_ID,
        replaceDataInMap({
          datasetToReplaceId: zarr.id,
          datasetToUse: zarrProtoDataset(zarr),
          options: { centerMap: false, keepExistingConfig: true },
        })
      )
    );
  }

  loadZarr(dispatch, add);
}

/** The Zarr datasets kepler holds, as the identity the refresh compares on. */
function readZarrDatasets(store: Store): Array<{ id: string; storeUrl?: string; variable?: string }> {
  const visState = getVisState(store);
  return Object.entries(visState?.datasets ?? {})
    .filter(([, dataset]) => dataset.type === ZARR_TILE_TYPE)
    .map(([id, dataset]) => {
      const metadata = dataset.metadata as { storeUrl?: string; variable?: string } | undefined;
      return { id, storeUrl: metadata?.storeUrl, variable: metadata?.variable };
    });
}

/** Puts a Zarr variable's calendar on the map, so the clock has a column. */
export function syncZarrCalendar(store: Store, dispatch: Dispatch, zarr: ZarrDataset): void {
  syncCalendarDataset(store, dispatch, {
    id: zarrCalendarDatasetId(zarr.id),
    label: zarr.label,
    times: zarr.times,
  });
}

/**
 * Points a Zarr layer at a moment, by its own index label.
 *
 * The label rather than a timestamp, because TiTiler hands it straight to
 * xarray's `.sel`, which matches exactly and offers no nearest-neighbour
 * fallback: a store stamped at 09:00 answers 500 to the date-only spelling of
 * its own dates.
 *
 * One dispatch and no dataset touched: the label lands in `visConfig`,
 * `zarrTileLayer` builds a new tile url from it, and deck refetches only the
 * tiles on screen. Quiet when the layer already shows that moment, which is most
 * of the time — a drag of the widget between two dates arrives here and stops.
 */
export function applyZarrLabel(store: Store, dispatch: Dispatch, dataId: string, label: string): boolean {
  const layer = getVisState(store)?.layers.find((candidate) => candidate.config?.dataId === dataId);
  if (!layer) {
    return false;
  }
  if (layer.config?.visConfig?.zarrLabel === label) {
    return true;
  }
  return applyLayerVisConfig(store, dispatch, dataId, { zarrLabel: label });
}
