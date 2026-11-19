import { useEffect, useRef, useState } from 'react';
import type { Store } from 'redux';

import type { RasterDataset } from '../data/rasterDataset';
import {
  applyWmsLayerChoice,
  readDatasetsById,
  reloadExternalSource,
  readViewportBounds,
  refreshRasters,
  setRasterLayerVisible,
  swapRasterScene,
  syncSeriesCalendars,
} from '../panel/keplerAdapter';
import {
  type CatalogDatasetLike,
  catalogSeriesRasters,
  featuresOf,
  featuresOfSource,
  featuresUrl,
  followedArea,
  searchOf,
  searchScenes,
  seriesCalendar,
  seriesRaster,
  type SearchedScenes,
  type SeriesSearch,
} from './catalogSource';

/** A searched series on the map: its dataset, its catalog and its search. */
interface SearchSpec extends SeriesSearch {
  id: string;
  uid: string;
}

/** How long the time range and the view must hold still before the searches follow them. */
const SEARCH_DELAY_MS = 700;

/**
 * The series added from a catalog that the map holds, as rasters for its time filter to move through (the panel's
 * raster timeline, as for a query's series), each with the calendar the filter hangs from.
 *
 * Read from kepler's store rather than kept beside it: a series is on the map while its dataset is, whether it came
 * from Add from catalog, a saved dashboard or a paste, and gone when the user removes it. Calendars are written on a
 * microtask, never inside kepler's dispatch (same reason as `useRasterTimeline`).
 *
 * A searched series (`catalogSearch`) is searched again whenever the dashboard's time range changes, through its
 * catalog's data source. Two scenes or more go to the timeline; one is simply drawn; none hides the layer, since the
 * area has nothing in that range.
 */
export function useCatalogSeries(store: Store, isReady: boolean, range: { from: number; to: number }): RasterDataset[] {
  // The dashboard's time range for the features that follow it, read when the view moves.
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);
  const [series, setSeries] = useState<RasterDataset[]>([]);
  const [specs, setSpecs] = useState<SearchSpec[]>([]);
  const searched = useRef(new Map<string, { key: string; found: SearchedScenes; applied: boolean }>());
  const seen = useRef<{ datasets: unknown; key: string; specs: string; view: string }>({
    datasets: null,
    key: '[]',
    specs: '[]',
    view: '',
  });
  const reread = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    let live = true;
    // The area a series that follows the view is searched over, as the view moves.
    const viewArea = () => {
      const view = readViewportBounds(store);
      return followedArea(view ? [view.west, view.south, view.east, view.north] : null);
    };
    const read = (force = false) => {
      const datasets = readDatasetsById(store);
      if (!live || !datasets || (!force && datasets === seen.current.datasets)) {
        return;
      }
      const area = viewArea();
      const found = new Map([...searched.current].map(([id, { found: scenes }]) => [id, scenes]));
      const rasters = catalogSeriesRasters(datasets, found);
      syncSeriesCalendars(
        store,
        store.dispatch,
        rasters.map((raster) => ({ id: raster.id, label: raster.label, times: seriesCalendar(raster) }))
      );

      const nowSpecs: SearchSpec[] = [];
      for (const [id, dataset] of Object.entries(datasets)) {
        const search = searchOf(dataset.metadata);
        const uid = dataset.metadata?.catalogUid;
        if (search && typeof uid === 'string') {
          nowSpecs.push({ id, uid, ...search, bbox: search.followView && area ? area : search.bbox });
          applyFewScenes(store, id, rasters, datasets[id], searched.current.get(id));
        }
      }

      // What the timeline needs to know; the scene each one shows is its own business.
      const key = JSON.stringify(
        rasters.map((raster) => [raster.id, raster.kind, raster.tileServerUrls, raster.scenes])
      );
      const specsKey = JSON.stringify(nowSpecs);
      if (key !== seen.current.key) {
        setSeries(rasters);
      }
      if (specsKey !== seen.current.specs) {
        setSpecs(nowSpecs);
      }
      seen.current = { datasets, key, specs: specsKey, view: JSON.stringify(area) };
    };
    // A WMS added from a catalog draws the catalog's layer once kepler has made its own (it reads the service's
    // list first, and would draw its first layer). Once per dataset: afterwards the layer is the user's to change.
    const wmsChosen = new Set<string>();
    const chooseWmsLayers = () => {
      for (const [id, dataset] of Object.entries(readDatasetsById(store) ?? {})) {
        const layer = dataset.metadata?.catalogWmsLayer;
        if (
          typeof layer === 'string' &&
          !wmsChosen.has(id) &&
          applyWmsLayerChoice(store, store.dispatch, {
            id,
            label: dataset.label ?? id,
            serviceUrl: '',
            layerName: layer,
            times: [],
          })
        ) {
          wmsChosen.add(id);
        }
      }
    };
    // Features from a catalog's OGC API follow the view and the time range: their address is asked again once both
    // hold still (SEARCH_DELAY_MS), and kepler loads it again, keeping the layer.
    let featuresTimer: ReturnType<typeof setTimeout> | null = null;
    const followFeatures = () => {
      if (featuresTimer !== null) {
        clearTimeout(featuresTimer);
      }
      featuresTimer = setTimeout(() => {
        featuresTimer = null;
        if (!live) {
          return;
        }
        const view = readViewportBounds(store);
        const area = followedArea(view ? [view.west, view.south, view.east, view.north] : null);
        for (const [id, dataset] of Object.entries(readDatasetsById(store) ?? {})) {
          const search = featuresOf(dataset.metadata) ?? featuresOfSource(id, dataset.metadata?.source);
          if (search) {
            const bbox = search.followView && area ? area : search.bbox;
            const source = featuresUrl(search.itemsHref, bbox, search.time ? rangeRef.current : null, search.limit);
            reloadExternalSource(store, store.dispatch, id, source);
          }
        }
      }, SEARCH_DELAY_MS);
    };
    reread.current = () => {
      read(true);
      followFeatures();
    };
    read();
    // A move of the view is no change of datasets: read again when the area it would search changes.
    const unsubscribe = store.subscribe(() =>
      queueMicrotask(() => {
        const moved = JSON.stringify(viewArea()) !== seen.current.view;
        read(moved);
        if (moved) {
          followFeatures();
        }
        chooseWmsLayers();
      })
    );
    return () => {
      live = false;
      unsubscribe();
      if (featuresTimer !== null) {
        clearTimeout(featuresTimer);
      }
    };
  }, [store, isReady]);

  // A new time range asks the features that follow it again.
  useEffect(() => {
    reread.current();
  }, [range.from, range.to]);

  const { from, to } = range;
  // Every searched series, again for each time range: after it holds still a moment, and only what changed.
  useEffect(() => {
    if (specs.length === 0) {
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      for (const spec of specs) {
        const key = JSON.stringify([spec.uid, spec.target, spec.bbox, from, to]);
        if (searched.current.get(spec.id)?.key === key) {
          continue;
        }
        searchScenes(spec.uid, spec, { from, to })
          .then((found) => {
            if (live) {
              searched.current.set(spec.id, { key, found, applied: false });
              reread.current();
            }
          })
          .catch(() => undefined);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [specs, from, to]);

  return series;
}

/**
 * A search that found none or one scene, which the timeline does not move: none hides the layer, one is drawn. Once
 * per search answer, so the user's own hiding of the layer afterwards stands.
 */
function applyFewScenes(
  store: Store,
  id: string,
  timeline: RasterDataset[],
  dataset: CatalogDatasetLike,
  answer: { found: SearchedScenes; applied: boolean } | undefined
): void {
  if (!answer || answer.applied || timeline.some((raster) => raster.id === id)) {
    return;
  }
  const scenes = answer.found.scenes;
  if (scenes.length === 0) {
    answer.applied = setRasterLayerVisible(store, store.dispatch, id, false);
    return;
  }
  // One scene: drawn as it is, no clock.
  const raster = seriesRaster(id, dataset, [{ ...scenes[0], time: null }]);
  if (!raster) {
    return;
  }
  if (!swapRasterScene(store, store.dispatch, raster)) {
    refreshRasters(store, store.dispatch, [raster]);
  }
  setRasterLayerVisible(store, store.dispatch, id, true);
  answer.applied = true;
}
