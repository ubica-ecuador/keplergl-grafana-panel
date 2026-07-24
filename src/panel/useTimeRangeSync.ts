import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { pushTimeRange, readTimeRange } from './keplerAdapter';
import { TimeSyncGuard, type TimeRangeMs, type TimeSyncMode } from './timeSync';

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
 * - `off`: no coupling at all.
 *
 * Reconciliation is driven by a store subscription, which makes it robust to
 * timing: kepler ingests data asynchronously, so the first push can land before
 * there is a time column to bind a filter to; the subscription simply reconciles
 * again once the dataset arrives. Crucially the reconcile runs on a **microtask**
 * rather than straight inside the subscription — dispatching a filter change
 * while kepler is still mid-dispatch re-enters its reducer and overflows the
 * stack, so the push must happen at a clean point instead.
 *
 * A single {@link TimeSyncGuard} shared by both directions stops each side from
 * echoing the other into a loop; the push commits only when it actually ran, so
 * a push that could not bind yet still retries.
 */
export function useTimeRangeSync({ store, isReady, mode, grafanaRange, datasets, onChangeGrafanaRange }: Params): void {
  const guard = useRef(new TimeSyncGuard());

  // Refs so the reconcile closure always sees the latest values without being
  // torn down and re-created on every render.
  const grafanaRangeRef = useRef(grafanaRange);
  grafanaRangeRef.current = grafanaRange;
  const onChangeRef = useRef(onChangeGrafanaRange);
  onChangeRef.current = onChangeGrafanaRange;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const reconcile = useRef(() => {
    const currentMode = modeRef.current;
    if (currentMode === 'off') {
      return;
    }

    // Grafana -> map: reflect a new dashboard range onto the time filter. The
    // guard commits only on a successful push, so a push that finds no time
    // column yet stays "new" and retries on the next store change.
    const grafana = grafanaRangeRef.current;
    if (guard.current.isNew(grafana) && pushTimeRange(store, store.dispatch, grafana)) {
      guard.current.commit(grafana);
      return;
    }

    // Map -> Grafana: propagate the user dragging the time slider.
    if (currentMode === 'bidirectional') {
      const mapRange = readTimeRange(store);
      if (mapRange && guard.current.accept(mapRange)) {
        onChangeRef.current?.(mapRange);
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

  // One subscription for the lifecycle of a ready map. Reconcile once up front
  // in case the data is already loaded, then on every store change.
  useEffect(() => {
    if (!isReady || mode === 'off') {
      return;
    }
    schedule.current();
    return store.subscribe(schedule.current);
  }, [isReady, mode, store]);

  // A pure dashboard-time change moves no kepler state, so it would not trip the
  // subscription — reconcile explicitly when the range or the data changes.
  useEffect(() => {
    if (isReady) {
      schedule.current();
    }
  }, [isReady, grafanaRange.from, grafanaRange.to, datasets]);
}
