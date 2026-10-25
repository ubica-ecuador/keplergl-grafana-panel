import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import {
  applyAreaFilter,
  drawArea,
  hasVisibleLayer,
  readDrawnAreas,
  readFigures,
  readSyncSlices,
  removeFigure,
} from './keplerAdapter';
import { areaFingerprints, decideAreaInbound, decideAreaPublish } from './areaSync';
import { SliceWatcher } from './sliceWatcher';
import { readVariable } from './useVariableSync';
import type { ArealGeometry } from '../data/wktToGeoJson';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** Dashboard variable the drawn area is published to; empty disables the hook. */
  variable: string;
}

/**
 * How long a figure must rest before it reaches the dashboard.
 *
 * Dragging a vertex in EDIT_VERTEX mode dispatches a features update per
 * pointer move; without a trailing delay a single drag would put every panel
 * that reads the variable through a query per frame. Same figure as the time
 * variable sync, and no playback cap here — no animation drives this channel.
 */
const PUBLISH_DELAY_MS = 300;

/**
 * Publishes the figure drawn on the map to a dashboard variable, as WKT, and
 * draws on the map what reaches the variable from elsewhere.
 *
 * The variable exists for the *other* panels' queries
 * (`ST_GeomFromText($area, 4326)`); feeding it into this panel's own query is
 * the selection ratchet the cross-filtering design doc forbids. The way back
 * is a figure instead: a filters panel clearing the area removes the figures,
 * and an area arriving in a link or from another panel is drawn and applied as
 * a kepler polygon filter, the same as one the user draws — see
 * `decideAreaInbound`.
 *
 * Never writes on dashboard load: the first reconcile adopts whatever figures
 * a saved config restored without publishing, so the value a shared link
 * arrived with survives. From then on it publishes the most recently drawn or
 * edited figure once it rests, and clears the variable when the published
 * figure is deleted with none left to take over.
 *
 * Same structural rules as the other sync hooks: reconcile on a microtask,
 * never inside the store subscription, and gate the reconcile on the slices
 * that can actually carry a figure — see `readSyncSlices`.
 */
export function useAreaSync({ store, isReady, variable }: Params): void {
  const variableRef = useRef(variable);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    variableRef.current = variable;
  });

  /**
   * False while this panel is live; true from the moment it tears down.
   *
   * kepler deletes its store entry as the panel unmounts, and that
   * notification reaches this hook's subscriber before React runs the cleanup
   * below. The reconcile it schedules therefore fires *after* teardown, finds
   * no figures left, and reads that absence as the user deleting the published
   * one — clearing a variable nobody touched. Cancelling the pending write in
   * the cleanup is not enough: the timer is armed by that late reconcile, on a
   * microtask, after the cleanup has already run. Reset when the effect
   * re-arms, so a change of variable does not retire the hook for good.
   */
  const disposed = useRef(false);

  /** id → WKT observed on the previous pass; null until the first adopts. */
  const lastSeen = useRef<Record<string, string> | null>(null);
  const publishedId = useRef<string | null>(null);

  /** The variable's value in the URL on the last look; null before the first. */
  const observed = useRef<string | undefined | null>(null);
  /** An area from the variable, waiting for the map to have a layer to filter. */
  const toDraw = useRef<{ geometry: ArealGeometry; wkt: string } | null>(null);

  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWrite = useRef<{ value: string; id: string | null } | null>(null);

  const publish = useRef(() => {
    publishTimer.current = null;
    const pending = pendingWrite.current;
    pendingWrite.current = null;
    if (!pending || !variableRef.current || disposed.current) {
      return;
    }
    locationService.partial({ [`var-${variableRef.current}`]: pending.value }, true);
    publishedId.current = pending.id;
  });

  const schedulePublish = useRef((value: string, id: string | null) => {
    // Each change overwrites the pending write and rearms the timer, so the
    // write that fires carries the geometry at rest — gesture-end semantics.
    pendingWrite.current = { value, id };
    if (publishTimer.current !== null) {
      clearTimeout(publishTimer.current);
    }
    publishTimer.current = setTimeout(() => publish.current(), PUBLISH_DELAY_MS);
  });

  const cancelPublish = useRef(() => {
    if (publishTimer.current !== null) {
      clearTimeout(publishTimer.current);
      publishTimer.current = null;
    }
    pendingWrite.current = null;
  });

  /**
   * Draws the area that came in through the variable, once the map has a
   * visible layer to filter by it. Until then a saved config may still be on
   * its way with the same figure, as on a dashboard whose variable defaults to
   * the figure it was saved with: one that carries the value by then is kept,
   * and nothing is drawn.
   */
  const draw = useRef(() => {
    const area = toDraw.current;
    if (area === null || !hasVisibleLayer(store)) {
      return;
    }
    toDraw.current = null;
    if (Object.values(areaFingerprints(readDrawnAreas(store))).includes(area.wkt)) {
      return;
    }
    const id = drawArea(store.dispatch, area.geometry, readFigures(store));
    applyAreaFilter(store, store.dispatch, id);
    // Seen and published already, so the reconcile that follows writes nothing back.
    lastSeen.current = { [id]: area.wkt };
    publishedId.current = id;
  });

  const reconcile = useRef(() => {
    if (disposed.current) {
      return;
    }
    draw.current();
    const candidates = readDrawnAreas(store);
    const decision = decideAreaPublish({
      candidates,
      lastSeen: lastSeen.current,
      publishedId: publishedId.current,
    });
    // Always adopt what kepler settled on, whatever was decided.
    lastSeen.current = areaFingerprints(candidates);

    if (decision.action === 'publish') {
      schedulePublish.current(decision.wkt, decision.id);
    } else if (decision.action === 'clear') {
      // Empty keeps the SQL guard (`$area != ''`) literal on the consumer side.
      schedulePublish.current('', null);
    }
  });

  /** The way back: the variable moved in the URL, maybe by someone else. */
  const look = useRef(() => {
    if (disposed.current || !variableRef.current) {
      return;
    }
    const raw = readVariable(variableRef.current);
    const value = typeof raw === 'string' ? raw : undefined;
    const previous = observed.current;
    observed.current = value;
    if (pendingWrite.current) {
      // A figure the user just drew is about to be written: it is the newer of the two.
      return;
    }
    const decision = decideAreaInbound({ value, previous, fingerprints: areaFingerprints(readDrawnAreas(store)) });
    if (decision.action === 'clear') {
      // Nothing published is left to hand over: the deletions below must not read as the user's.
      publishedId.current = null;
      toDraw.current = null;
      readFigures(store).forEach((figure) => removeFigure(store.dispatch, figure));
    } else if (decision.action === 'draw') {
      toDraw.current = { geometry: decision.geometry, wkt: decision.wkt };
      draw.current();
    }
  });

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

  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (watcher.current.changed(readSyncSlices(store))) {
      schedule.current();
    }
  });

  useEffect(() => {
    if (!isReady || !variable) {
      return;
    }

    // Captured rather than read in the cleanup: the ref is assigned once, but
    // reading it on teardown is what the exhaustive-deps rule warns about.
    const cancel = cancelPublish.current;
    disposed.current = false;
    observed.current = null;
    toDraw.current = null;

    schedule.current();
    const unsubscribe = store.subscribe(onStoreChange.current);
    look.current();
    const unlisten = locationService.getHistory().listen(() => look.current());
    return () => {
      disposed.current = true;
      unsubscribe();
      unlisten();
      cancel();
    };
  }, [isReady, variable, store]);
}
