import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { readDrawnAreas, readSyncSlices } from './keplerAdapter';
import { decideAreaPublish, lineFingerprints } from './areaSync';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** Dashboard variable the drawn line is published to; empty disables the hook. */
  variable: string;
}

/** How long a line must rest before it reaches the dashboard: a vertex dragged writes once, as the area does. */
const PUBLISH_DELAY_MS = 300;

/**
 * Publishes the line drawn on the map (kepler's draw tool, Line) to a dashboard variable, as WKT, for the other
 * panels' queries along it: a vertical section (`ST_LineLocatePoint`), a profile, the rows near it. The area's rules
 * (useAreaSync.ts), on lines: never writes on load (the first pass adopts the lines a saved config restored), then
 * the most recently drawn or edited line once it rests, and an empty value when the published line is deleted with
 * none left to take over. Map to variable only: a line arriving in the variable from elsewhere is not drawn.
 */
export function useLineSync({ store, isReady, variable }: Params): void {
  const variableRef = useRef(variable);
  useEffect(() => {
    variableRef.current = variable;
  });

  /** True from the moment the panel tears down: kepler's last store notification must not read as a deletion. */
  const disposed = useRef(false);
  const lastSeen = useRef<Record<string, string> | null>(null);
  const publishedId = useRef<string | null>(null);
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
    if (disposed.current) {
      return;
    }
    const candidates = readDrawnAreas(store);
    const decision = decideAreaPublish({
      candidates,
      lastSeen: lastSeen.current,
      publishedId: publishedId.current,
      fingerprintsOf: lineFingerprints,
    });
    lastSeen.current = lineFingerprints(candidates);
    if (decision.action === 'publish') {
      schedulePublish.current(decision.wkt, decision.id);
    } else if (decision.action === 'clear') {
      // Empty keeps the SQL guard (`$line != ''`) literal on the consumer side.
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
    const cancel = cancelPublish.current;
    disposed.current = false;
    lastSeen.current = null;
    schedule.current();
    const unsubscribe = store.subscribe(onStoreChange.current);
    return () => {
      disposed.current = true;
      unsubscribe();
      cancel();
    };
  }, [isReady, variable, store]);
}
