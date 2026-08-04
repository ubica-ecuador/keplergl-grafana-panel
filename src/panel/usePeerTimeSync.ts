import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { pushAnimationTime, pushTimeRange, readAnimationTime, readTimeRange } from './keplerAdapter';
import { timeChannel, type TimeMessage } from './timeChannel';
import { rangesEqual, type TimeRangeMs } from './timeSync';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** Whether this map joins the dashboard's time channel at all. */
  enabled: boolean;
}

/**
 * Keeps the maps on a dashboard on the same clock, without touching Grafana.
 *
 * `bidirectional` mode can already chain one map to the others — it moves the
 * dashboard time range, which every other map follows — but a range change
 * re-runs every query on the dashboard, so an animation costs a stream of them:
 * 92 queries in ten seconds, measured on two panels. This instead passes the
 * time between the panels in the browser, so playing an animation on one map
 * moves the others and the database is never asked anything.
 *
 * Both of kepler's clocks travel: the time filter window and the trip animation
 * playhead. A map sends whichever it has and applies whichever it can.
 *
 * Echoes are cut by remembering the last value seen in either direction. What is
 * recorded after applying an incoming value is what kepler actually settled on,
 * not what arrived — kepler clamps both clocks to the data's own domain, and
 * recording the requested value would make the clamped one look like a local
 * change and bounce it straight back.
 */
export function usePeerTimeSync({ store, isReady, enabled }: Params): void {
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) {
    idRef.current = timeChannel.nextId();
  }

  const lastFilter = useRef<TimeRangeMs | null>(null);
  const lastPlayhead = useRef<number | null>(null);

  const apply = useRef((message: TimeMessage) => {
    if (message.filter) {
      pushTimeRange(store, store.dispatch, message.filter);
    }
    if (typeof message.playhead === 'number') {
      pushAnimationTime(store, store.dispatch, message.playhead);
    }
    // Redux has already settled, so this reads the clamped result.
    lastFilter.current = readTimeRange(store);
    lastPlayhead.current = readAnimationTime(store);
  });

  const broadcast = useRef(() => {
    const filter = readTimeRange(store);
    const playhead = readAnimationTime(store);
    const filterMoved = !rangesEqual(filter, lastFilter.current);
    const playheadMoved = playhead !== lastPlayhead.current;
    if (!filterMoved && !playheadMoved) {
      return;
    }

    lastFilter.current = filter;
    lastPlayhead.current = playhead;
    timeChannel.publish({
      senderId: idRef.current as string,
      ...(filterMoved ? { filter } : {}),
      ...(playheadMoved ? { playhead } : {}),
    });
  });

  // Same microtask deferral as the other sync hooks: dispatching from inside a
  // store subscription re-enters kepler's reducer.
  const pending = useRef(false);
  const schedule = useRef(() => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    void Promise.resolve().then(() => {
      pending.current = false;
      broadcast.current();
    });
  });

  useEffect(() => {
    if (!isReady || !enabled) {
      return;
    }

    const id = idRef.current as string;
    // Seed from the current state so joining the channel does not immediately
    // announce a clock nobody moved.
    lastFilter.current = readTimeRange(store);
    lastPlayhead.current = readAnimationTime(store);

    const leave = timeChannel.subscribe(id, (message) => apply.current(message));
    const unsubscribe = store.subscribe(schedule.current);
    return () => {
      leave();
      unsubscribe();
    };
  }, [isReady, enabled, store]);
}
