import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Store } from 'redux';

import type { SavedMapConfig } from '../data/mapConfig';
import { captureMapConfig } from './keplerAdapter';

/**
 * Saving the map's configuration, the one way it is done.
 *
 * Two buttons ask for it: **Save current map configuration** in the panel
 * options, which can only reach the panel by bumping `saveRequest` (an option
 * editor has no other channel to the panel), and the button drawn on the map
 * while the panel is edited, which calls the returned function directly. Both
 * end here, so they capture the same thing and record it the same way.
 *
 * The capture is recorded in `appliedConfigRef` before it is handed on, so the
 * options change it causes does not rebuild the map the user is looking at.
 *
 * Returns the save, which says whether anything was captured: nothing is
 * before kepler has registered its instance.
 */
export function useSaveMapConfig({
  store,
  saveRequest,
  onMapConfigCaptured,
  appliedConfigRef,
}: {
  store: Store;
  /** Bumped by the options editor to request a save. */
  saveRequest: number;
  onMapConfigCaptured: (config: SavedMapConfig) => void;
  /** The config the map was last built from, as the load effect compares it. */
  appliedConfigRef: MutableRefObject<SavedMapConfig | null | undefined>;
}): () => boolean {
  const handledSaveRequest = useRef(saveRequest);

  const save = useCallback(() => {
    const captured = captureMapConfig(store);
    if (!captured) {
      return false;
    }
    appliedConfigRef.current = captured;
    onMapConfigCaptured(captured);
    return true;
  }, [store, appliedConfigRef, onMapConfigCaptured]);

  useEffect(() => {
    if (saveRequest === handledSaveRequest.current) {
      return;
    }
    handledSaveRequest.current = saveRequest;
    save();
  }, [saveRequest, save]);

  return save;
}
