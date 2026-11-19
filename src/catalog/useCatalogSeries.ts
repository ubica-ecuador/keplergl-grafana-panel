import { useEffect, useRef, useState } from 'react';
import type { Store } from 'redux';

import type { RasterDataset } from '../data/rasterDataset';
import { readDatasetsById, syncSeriesCalendars } from '../panel/keplerAdapter';
import { catalogSeriesRasters, seriesCalendar } from './catalogSource';

/**
 * The series added from a catalog that the map holds, as rasters for its time filter to move through (the panel's
 * raster timeline, as for a query's series), each with the calendar the filter hangs from.
 *
 * Read from kepler's store rather than kept beside it: a series is on the map while its dataset is, whether it came
 * from Add from catalog, a saved dashboard or a paste, and gone when the user removes it. Calendars are written on a
 * microtask, never inside kepler's dispatch (same reason as `useRasterTimeline`).
 */
export function useCatalogSeries(store: Store, isReady: boolean): RasterDataset[] {
  const [series, setSeries] = useState<RasterDataset[]>([]);
  const seen = useRef<{ datasets: unknown; key: string }>({ datasets: null, key: '[]' });

  useEffect(() => {
    if (!isReady) {
      return;
    }
    let live = true;
    const read = () => {
      const datasets = readDatasetsById(store);
      if (!live || !datasets || datasets === seen.current.datasets) {
        return;
      }
      const found = catalogSeriesRasters(datasets);
      // What the timeline needs to know; the scene each one shows is its own business.
      const key = JSON.stringify(found.map((raster) => [raster.id, raster.kind, raster.tileServerUrls, raster.scenes]));
      seen.current = { datasets, key: seen.current.key };
      syncSeriesCalendars(
        store,
        store.dispatch,
        found.map((raster) => ({ id: raster.id, label: raster.label, times: seriesCalendar(raster) }))
      );
      if (key !== seen.current.key) {
        seen.current = { datasets, key };
        setSeries(found);
      }
    };
    read();
    const unsubscribe = store.subscribe(() => queueMicrotask(read));
    return () => {
      live = false;
      unsubscribe();
    };
  }, [store, isReady]);

  return series;
}
