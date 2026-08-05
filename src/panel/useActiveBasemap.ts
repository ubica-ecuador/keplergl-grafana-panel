import { useEffect, useRef, useState } from 'react';
import type { Store } from 'redux';

import { readBasemapId } from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only exposes mapStyle once its instance has registered. */
  isReady: boolean;
}

/**
 * The id of the base map style the map is currently showing, kept current by
 * subscribing to the store.
 *
 * kepler dispatches on every pan and hover; `SliceWatcher` limits reconciles
 * to the id itself changing, so a re-render only happens when the active
 * style really does. Never dispatches — this only reads.
 */
export function useActiveBasemap({ store, isReady }: Params): string | null {
  const [basemapId, setBasemapId] = useState<string | null>(null);

  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    const id = readBasemapId(store);
    if (watcher.current.changed([id])) {
      setBasemapId(id);
    }
  });

  useEffect(() => {
    if (!isReady) {
      return;
    }
    // Pick up the style kepler registered on mount before the first change.
    onStoreChange.current();
    return store.subscribe(onStoreChange.current);
  }, [isReady, store]);

  return basemapId;
}
