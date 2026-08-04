import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { isTimeFilterAnimating, pushTimeRange, readSyncSlices, readTimeDomain, readTimeRange } from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';
import { TimeSyncGuard, couplesDashboardRange, type TimeRangeMs, type TimeSyncMode } from './timeSync';

/** How long the slider must rest before its window reaches the dashboard. */
const EMIT_DELAY_MS = 300;

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  mode: TimeSyncMode;
  /** The dashboard time range, in epoch ms. */
  grafanaRange: TimeRangeMs;
  /** Datasets currently loaded — kept in deps so a data change re-reconciles. */
  datasets: PanelDataset[];
  /** Called to move the dashboard range; only used in bidirectional mode. */
  onChangeGrafanaRange?: (range: TimeRangeMs) => void;
}

/**
 * Keeps the dashboard time range and kepler's time filter in step.
 *
 * - `toMap` (default): the dashboard drives the map's time filter, one way.
 * - `bidirectional`: dragging the map's time slider also moves the dashboard.
 * - `off` and `variables`: no coupling here at all. `variables` publishes the
 *   window through {@link useTimeVariableSync} instead, which deliberately
 *   leaves the dashboard range — and so the query — where the user put it.
 *
 * Reconciliation is driven by a store subscription, which makes it robust to
 * timing: kepler ingests data asynchronously, so the first push can land before
 * there is a time column to bind a filter to; the subscription simply reconciles
 * again once the dataset arrives. Crucially the reconcile runs on a **microtask**
 * rather than straight inside the subscription — dispatching a filter change
 * while kepler is still mid-dispatch re-enters its reducer and overflows the
 * stack, so the push must happen at a clean point instead.
 *
 * The {@link TimeSyncGuard} stops each side from echoing the other into a loop.
 * It keeps the range pushed and the window kepler settled on in separate slots,
 * because the two differ whenever the dashboard window is wider than the data —
 * treating them as one is what used to drag the time picker down to the data's
 * extent on load, unasked. It also watches the data's domain, so a window that
 * moved because the query re-ran is absorbed rather than reported as a drag.
 */
export function useTimeRangeSync({ store, isReady, mode, grafanaRange, datasets, onChangeGrafanaRange }: Params): void {
  const guard = useRef(new TimeSyncGuard());

  // Refs so the reconcile closure always sees the latest values without being
  // torn down and re-created on every render. Updated in an effect rather than
  // during render — reconcile only ever runs on a microtask, after effects, so
  // the refs are always current by the time it reads them.
  const grafanaRangeRef = useRef(grafanaRange);
  const onChangeRef = useRef(onChangeGrafanaRange);
  const modeRef = useRef(mode);
  useEffect(() => {
    grafanaRangeRef.current = grafanaRange;
    onChangeRef.current = onChangeGrafanaRange;
    modeRef.current = mode;
  });

  // The map -> Grafana direction is debounced and the Grafana -> map one is not,
  // deliberately: moving the dashboard range is a discrete act that should land
  // at once, while kepler updates the time filter on every pointer move, so a
  // single drag would otherwise re-run every query on the dashboard per frame.
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEmit = useRef<TimeRangeMs | null>(null);

  const flushEmit = useRef(() => {
    emitTimer.current = null;
    const range = pendingEmit.current;
    pendingEmit.current = null;
    if (!range) {
      return;
    }
    // Playing the slider walks the window across the domain about once a frame,
    // and every one of those would be a fresh dashboard range. Sit the animation
    // out; stopping it is itself a store change, which reports where it landed.
    if (isTimeFilterAnimating(store)) {
      return;
    }
    onChangeRef.current?.(range);
  });

  const scheduleEmit = useRef((range: TimeRangeMs) => {
    pendingEmit.current = range;
    if (emitTimer.current !== null) {
      clearTimeout(emitTimer.current);
    }
    emitTimer.current = setTimeout(() => flushEmit.current(), EMIT_DELAY_MS);
  });

  const cancelEmit = useRef(() => {
    if (emitTimer.current !== null) {
      clearTimeout(emitTimer.current);
      emitTimer.current = null;
    }
    pendingEmit.current = null;
  });

  const reconcile = useRef(() => {
    const currentMode = modeRef.current;
    if (!couplesDashboardRange(currentMode)) {
      return;
    }

    // Grafana -> map: reflect a new dashboard range onto the time filter. The
    // guard records only on a successful push, so a push that finds no time
    // column yet stays pending and retries on the next store change.
    const grafana = grafanaRangeRef.current;
    if (guard.current.shouldPush(grafana) && pushTimeRange(store, store.dispatch, grafana)) {
      // Read back rather than record what was asked for: kepler clamps the
      // window to the data's own domain, and it is the clamped value the next
      // pass has to recognise as "where we put it".
      guard.current.recordPush(grafana, readTimeRange(store));
      return;
    }

    // Map -> Grafana: propagate the user dragging the time slider, and only
    // that — the guard absorbs a window that moved because the data did.
    if (currentMode === 'bidirectional') {
      const dragged = guard.current.takeEmit(readTimeRange(store), readTimeDomain(store), grafana);
      if (dragged) {
        scheduleEmit.current(dragged);
      }
    }
  });

  // Debounce reconciles onto a microtask. A burst of store changes collapses
  // into one reconcile, and — the important part — the reconcile's own dispatch
  // runs after the current dispatch has fully settled, not nested inside it.
  const pending = useRef(false);
  const schedule = useRef(() => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    void Promise.resolve().then(() => {
      pending.current = false;
      reconcile.current();
    });
  });

  // Only store changes that touch the slices this reads are worth a reconcile;
  // kepler dispatches far more than that, and a viewport pan is a stream of
  // them. See `readSyncSlices`.
  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (watcher.current.changed(readSyncSlices(store))) {
      schedule.current();
    }
  });

  // One subscription for the lifecycle of a ready map. Reconcile once up front
  // in case the data is already loaded, then on every relevant store change.
  useEffect(() => {
    if (!isReady || !couplesDashboardRange(mode)) {
      return;
    }
    const cancel = cancelEmit.current;

    schedule.current();
    const unsubscribe = store.subscribe(onStoreChange.current);
    return () => {
      unsubscribe();
      cancel();
    };
  }, [isReady, mode, store]);

  // A pure dashboard-time change moves no kepler state, so it would not trip the
  // subscription — reconcile explicitly when the range or the data changes.
  useEffect(() => {
    if (isReady) {
      schedule.current();
    }
  }, [isReady, grafanaRange.from, grafanaRange.to, datasets]);
}
