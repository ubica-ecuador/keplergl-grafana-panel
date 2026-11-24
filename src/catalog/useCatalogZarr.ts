import { useEffect, useMemo, useRef, useState } from 'react';
import type { Store } from 'redux';

import { framesToZarr, type ZarrDataset } from '../data/zarrDataset';
import { readDatasetsById, readViewportBounds, setZarrStyle } from '../panel/keplerAdapter';
import { ZARR_TILES_TYPE } from '../panel/zarrTileLayer';
import { featuresArea, readCatalogZarr } from './catalogSource';

/** How long the time range must hold still before the variables are asked again. */
const SETTLE_MS = 700;

/** A data cube's variable on the map, added from a catalog. */
interface CubeOnMap {
  id: string;
  label: string;
  uid: string;
  target: string;
  serverUrl: string;
}

/**
 * The data cube variables added from a catalog that the map holds, with their moments in the dashboard's time range,
 * for the Zarr timeline to walk (as a Zarr query's are).
 *
 * The moments are asked of the variable's catalog data source (its Zarr query) in each time range: the cube's own,
 * or the tile server's labels, which change as an archive grows. The ramp's range comes back too, and is put on the
 * dataset when the map has none yet. A dataset the user removes leaves the list, as it leaves kepler's store.
 */
export function useCatalogZarr(store: Store, isReady: boolean, range: { from: number; to: number }): ZarrDataset[] {
  const [cubes, setCubes] = useState<CubeOnMap[]>([]);
  const [layers, setLayers] = useState<ZarrDataset[]>([]);
  const seen = useRef('');

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const read = () => {
      const found: CubeOnMap[] = [];
      for (const [id, dataset] of Object.entries(readDatasetsById(store) ?? {})) {
        const m = (dataset.metadata ?? {}) as Record<string, unknown>;
        if (
          (dataset as { type?: string }).type === ZARR_TILES_TYPE &&
          typeof m.catalogZarr === 'string' &&
          typeof m.catalogUid === 'string' &&
          typeof m.serverUrl === 'string'
        ) {
          found.push({
            id,
            label: dataset.label ?? id,
            uid: m.catalogUid,
            target: m.catalogZarr,
            serverUrl: m.serverUrl,
          });
        }
      }
      const key = JSON.stringify(found);
      if (key !== seen.current) {
        seen.current = key;
        setCubes(found);
      }
    };
    read();
    return store.subscribe(() => queueMicrotask(read));
  }, [store, isReady]);

  const { from, to } = range;
  useEffect(() => {
    if (cubes.length === 0) {
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const view = readViewportBounds(store);
      const area = featuresArea(view ? [view.west, view.south, view.east, view.north] : null);
      const answers = await Promise.all(
        cubes.map(async (cube) => {
          try {
            const frame = await readCatalogZarr(cube.uid, cube.target, cube.serverUrl, area, { from, to });
            const [zarr] = frame ? framesToZarr([frame], {}, { serverUrl: cube.serverUrl }) : [];
            const found: ZarrDataset | null = zarr
              ? { ...zarr, id: cube.id, label: cube.label, outsideWindow: 'latest' }
              : null;
            return found;
          } catch {
            return null;
          }
        })
      );
      if (!live) {
        return;
      }
      const found = answers.filter((z): z is ZarrDataset => z !== null);
      for (const zarr of found) {
        setZarrStyle(store, store.dispatch, zarr.id, { rescale: zarr.rescale, colormap: zarr.colormap });
      }
      setLayers(found);
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [store, cubes, from, to]);

  // Only those still on the map: one the user removed leaves at once, not at the next answer.
  return useMemo(() => layers.filter((layer) => cubes.some((cube) => cube.id === layer.id)), [layers, cubes]);
}
