import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import {
  isTimeFilterAnimating,
  pushAnimationTime,
  pushTimeRange,
  readAnimationDomain,
  readAnimationTime,
  readDatasetsSlice,
  readIsAnimating,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
} from './keplerAdapter';
import { LiveFollower } from './liveFollow';
import { SliceWatcher } from './sliceWatcher';
import { couplesDashboardRange, type TimeSyncMode } from './timeSync';

interface Params {
  store: Store;
  isReady: boolean;
  /** The query is streaming and the panel is set to follow it. */
  enabled: boolean;
  timeSync: TimeSyncMode;
}

/**
 * Keeps the map's clocks on the newest rows of a streaming query. The rules are
 * `LiveFollower`'s; this reads kepler after every change to the slices that
 * carry the clocks and the rows, and applies the moves.
 */
export function useLiveFollow({ store, isReady, enabled, timeSync }: Params): void {
  const follower = useRef(new LiveFollower());
  const moveWindow = !couplesDashboardRange(timeSync);
  const moveWindowRef = useRef(moveWindow);
  useEffect(() => {
    moveWindowRef.current = moveWindow;
  });

  const lastDatasets = useRef<unknown>(undefined);
  const run = useRef(() => {
    const datasets = readDatasetsSlice(store);
    const dataChanged = datasets !== lastDatasets.current;
    lastDatasets.current = datasets;
    const moves = follower.current.step(
      {
        playhead: readAnimationTime(store),
        animationDomain: readAnimationDomain(store),
        animating: readIsAnimating(store),
        window: readTimeRange(store),
        domain: readTimeDomain(store),
        windowPlaying: isTimeFilterAnimating(store),
        dataChanged,
      },
      moveWindowRef.current
    );
    if (moves.playhead !== undefined) {
      pushAnimationTime(store, store.dispatch, moves.playhead);
    }
    if (moves.window) {
      pushTimeRange(store, store.dispatch, moves.window);
    }
    if (moves.playhead !== undefined || moves.window) {
      // Redux has settled: what kepler kept, clamped, is the new baseline.
      follower.current.settled(readAnimationTime(store), readTimeRange(store));
    }
  });

  // Deferred to a microtask, as the other sync hooks do: dispatching from inside
  // a store subscription re-enters kepler's reducer.
  const pending = useRef(false);
  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (!watcher.current.changed(readSyncSlices(store)) || pending.current) {
      return;
    }
    pending.current = true;
    void Promise.resolve().then(() => {
      pending.current = false;
      run.current();
    });
  });

  useEffect(() => {
    if (!isReady || !enabled) {
      return;
    }
    follower.current = new LiveFollower();
    lastDatasets.current = undefined;
    run.current();
    return store.subscribe(onStoreChange.current);
  }, [isReady, enabled, store]);
}
