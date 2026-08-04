import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import {
  ensureTimeFilter,
  isTimeFilterAnimating,
  pushTimeRange,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
} from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';
import { timeChannel } from './timeChannel';
import type { TimeRangeMs } from './timeSync';
import {
  decideTimeSync,
  nextPublishDelay,
  readWindowFromVariables,
  timeVariableWrites,
  windowKey,
  type TimeVariableMapping,
} from './timeVariableSync';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** Whether the map publishes its time window at all. */
  enabled: boolean;
  mapping: TimeVariableMapping;
  /**
   * Whether playing the filter publishes as it runs.
   *
   * Off, a play is silent and the window reaches the dashboard once it stops —
   * the animation keeps every frame to itself. On, it publishes throughout, at
   * most every `MAX_PUBLISH_WAIT_MS`.
   */
  whilePlaying: boolean;
  /**
   * Whether this map follows the dashboard's shared clock.
   *
   * When it does, the map being played is often not this one: the animation
   * arrives over the peer channel as an ordinary filter change and this store's
   * own `isAnimating` never turns true. Only a follower should consult what the
   * peers are doing — a map that has left the channel is not being driven by
   * them, and someone else's playback is none of its business.
   */
  peerSync: boolean;
}

/**
 * How long the brush must rest before its window reaches the dashboard.
 *
 * kepler updates the filter on every pointer move, so without a trailing delay
 * a single drag would put the consuming panels through a query per frame. Long
 * enough to collapse a drag into one update, short enough to still feel like a
 * direct manipulation.
 */
const PUBLISH_DELAY_MS = 300;

/**
 * The longest a moving window may go unpublished, when publishing during
 * playback is turned on.
 *
 * Playback moves the filter about once a frame, so the delay above never
 * elapses and on its own would hold every update back until the animation
 * stopped. This cap makes the same timer fire mid-run, turning playback into a
 * dashboard that follows along instead of one that jumps at the end.
 *
 * The figure is a query budget, not a frame rate: each publish rewrites the URL
 * and re-runs every panel that reads the variables. Around a second and a half
 * reads as live while leaving a comfortable margin over the ~0.3 s an aggregate
 * over this data takes to come back. It does not buy smooth playback — the
 * propagation costs the animation frames either way, which is why the whole
 * behaviour is opt-in.
 */
const MAX_PUBLISH_WAIT_MS = 1500;

/**
 * Publishes the map's time window as a pair of dashboard variables, both ways.
 *
 * This is the alternative to `bidirectional` time sync, and the reason it exists
 * is that moving the dashboard time range from the map is self-defeating: the
 * re-query drops every row outside the new window, so the histogram behind the
 * brush rescales and the window can never be widened again from the map. Writing
 * variables instead costs only the panels that reference them, and leaves this
 * panel's own query — which still uses `$__timeFilter` — untouched. The dataset
 * stays whole, so the widget keeps showing all of it and the brush is a mask
 * over it, which is the behaviour the time widget is designed around.
 *
 * - Map → dashboard: dragging the brush writes both variables once it rests.
 *   Playing the filter writes them as it runs when `whilePlaying` is on, and
 *   otherwise only where it lands.
 * - Dashboard → map: setting either variable moves the brush, so a shared link
 *   or another panel's control restores the window.
 *
 * Same two structural rules as the other sync hooks: reconcile on a microtask,
 * never inside the store subscription, because dispatching there re-enters
 * kepler's reducer; and read variables from the URL rather than the template
 * service, whose resolved values lag our own writes.
 */
export function useTimeVariableSync({ store, isReady, enabled, mapping, whilePlaying, peerSync }: Params): void {
  /** The window both sides last agreed on — the echo cutter. */
  const lastKey = useRef<string | undefined>(undefined);

  const mappingRef = useRef(mapping);
  const whilePlayingRef = useRef(whilePlaying);
  const peerSyncRef = useRef(peerSync);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    mappingRef.current = mapping;
    whilePlayingRef.current = whilePlaying;
    peerSyncRef.current = peerSync;
  });

  /**
   * Whether the window is moving under a running clock rather than a hand.
   *
   * Local animation is the obvious case. The one that took a debugging session
   * to find is the other: with peer sync on, the map being played can be a
   * different panel entirely, and this one sees only its filter moving.
   */
  const clockRunning = useRef(
    () => isTimeFilterAnimating(store) || (peerSyncRef.current && timeChannel.anyPlaying())
  );

  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPublish = useRef<{ window: TimeRangeMs | null; domain: TimeRangeMs | null } | null>(null);
  /** When the run of changes now waiting to be published began. */
  const pendingSince = useRef<number | null>(null);

  const publish = useRef(() => {
    publishTimer.current = null;
    pendingSince.current = null;
    const pending = pendingPublish.current;
    pendingPublish.current = null;
    if (!pending) {
      return;
    }

    // Sitting the animation out is the option's whole point. Keep the window
    // and look again shortly rather than dropping it: a local stop arrives as a
    // store change that would reconcile anyway, but a peer's stop arrives over
    // the channel, which this store never hears. Dropping it there would leave
    // the last window of a peer-driven playback unpublished for good.
    if (!whilePlayingRef.current && clockRunning.current()) {
      pendingPublish.current = pending;
      publishTimer.current = setTimeout(() => publish.current(), PUBLISH_DELAY_MS);
      return;
    }

    const writes = timeVariableWrites(pending.window, pending.domain, mappingRef.current);
    if (Object.keys(writes).length === 0) {
      return;
    }

    const partial: Record<string, string> = {};
    for (const [variable, value] of Object.entries(writes)) {
      partial[`var-${variable}`] = value;
    }
    locationService.partial(partial, true);
    lastKey.current = windowKey(pending.window ?? pending.domain);
  });

  const schedulePublish = useRef((window: TimeRangeMs | null, domain: TimeRangeMs | null) => {
    pendingPublish.current = { window, domain };
    const now = Date.now();
    if (pendingSince.current === null) {
      pendingSince.current = now;
    }
    if (publishTimer.current !== null) {
      clearTimeout(publishTimer.current);
    }
    // Rearming on every change is what collapses a drag into one write; the cap
    // is what stops playback from rearming it forever. Without the cap this is
    // the plain trailing debounce a drag has always had.
    const cap = whilePlayingRef.current ? MAX_PUBLISH_WAIT_MS : Number.POSITIVE_INFINITY;
    const delay = nextPublishDelay(now, pendingSince.current, PUBLISH_DELAY_MS, cap);
    publishTimer.current = setTimeout(() => publish.current(), delay);
  });

  const cancelPublish = useRef(() => {
    if (publishTimer.current !== null) {
      clearTimeout(publishTimer.current);
      publishTimer.current = null;
    }
    pendingPublish.current = null;
    pendingSince.current = null;
  });

  const reconcile = useRef(() => {
    const current = mappingRef.current;
    if (!current.from || !current.to) {
      return;
    }

    // Nothing to publish or drive until there is a time filter to read. This
    // creates one — unnarrowed — when the data has a timestamp column, and
    // returns false when it does not, so the next store change retries.
    if (!ensureTimeFilter(store, store.dispatch)) {
      return;
    }

    const window = readTimeRange(store);
    const domain = readTimeDomain(store);
    const mapWindow = window ?? domain;
    const variableWindow = readWindowFromVariables(readVariables(current), current);

    const mapKey = windowKey(mapWindow);

    switch (decideTimeSync(mapKey, windowKey(variableWindow), lastKey.current)) {
      case 'none':
        lastKey.current = mapKey;
        cancelPublish.current();
        return;

      case 'toMap': {
        // Clearing the variables means "no restriction", which on the map is the
        // whole domain rather than an absent filter — the widget stays put and
        // simply opens up.
        const target = variableWindow ?? domain;
        if (target && pushTimeRange(store, store.dispatch, target)) {
          cancelPublish.current();
          // Record what kepler settled on, not what was asked for: it clamps the
          // window to the domain, and recording the request would make the
          // clamped result read as a fresh local change and bounce back.
          lastKey.current = windowKey(readTimeRange(store) ?? readTimeDomain(store));
        }
        return;
      }

      case 'toVariables':
        schedulePublish.current(window, domain);
        return;
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
    if (!isReady || !enabled || !mapping.from || !mapping.to) {
      return;
    }

    // Captured rather than read in the cleanup: the ref is assigned once, but
    // reading it on teardown is what the exhaustive-deps rule warns about.
    const cancel = cancelPublish.current;

    schedule.current();
    // Map → dashboard: react to the brush moving, and only to that — kepler
    // dispatches on every pointer move over the map. See `readSyncSlices`.
    const unsubscribeStore = store.subscribe(onStoreChange.current);
    // Dashboard → map: react to variable changes, which land in the URL.
    const unlisten = locationService.getHistory().listen(schedule.current);
    return () => {
      unsubscribeStore();
      unlisten();
      cancel();
    };
  }, [isReady, enabled, mapping.from, mapping.to, store]);
}

/** Both bound variables' current values, read from the URL. */
function readVariables(mapping: TimeVariableMapping): Record<string, unknown> {
  const search = locationService.getSearch();
  const read = (name: string): unknown => {
    const values = search.getAll(`var-${name}`);
    if (values.length === 0) {
      return undefined;
    }
    return values.length === 1 ? values[0] : values;
  };
  return { [mapping.from]: read(mapping.from), [mapping.to]: read(mapping.to) };
}
