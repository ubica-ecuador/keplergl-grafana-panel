import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { readDrawnAreas, readSyncSlices } from './keplerAdapter';
import { areaFingerprints, decideAreaPublish } from './areaSync';
import { SliceWatcher } from './sliceWatcher';

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
 * Publishes the figure drawn on the map to a dashboard variable, as WKT.
 *
 * One direction only, and deliberately so: the variable exists for the *other*
 * panels' queries (`ST_GeomFromText($area, 4326)`); parsing it back into a
 * drawn feature is work nobody has asked for, and feeding it into this panel's
 * own query is the selection ratchet the cross-filtering design doc forbids.
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

  /** id → WKT observed on the previous pass; null until the first adopts. */
  const lastSeen = useRef<Record<string, string> | null>(null);
  const publishedId = useRef<string | null>(null);

  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWrite = useRef<{ value: string; id: string | null } | null>(null);

  const publish = useRef(() => {
    publishTimer.current = null;
    const pending = pendingWrite.current;
    pendingWrite.current = null;
    if (!pending || !variableRef.current) {
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

  const reconcile = useRef(() => {
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

    schedule.current();
    const unsubscribe = store.subscribe(onStoreChange.current);
    return () => {
      unsubscribe();
      cancel();
    };
  }, [isReady, variable, store]);
}
