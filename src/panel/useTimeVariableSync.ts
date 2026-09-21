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
import { subscribeActivity } from './duckdbWasmActivity';
import { PublishGate } from './publishGate';
import { SliceWatcher } from './sliceWatcher';
import { timeChannel } from './timeChannel';
import type { TimeRangeMs } from './timeSync';
import {
  DEFAULT_PUBLISH_INTERVAL_MS,
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
   * most every `publishIntervalMs`.
   */
  whilePlaying: boolean;
  /** The least time between two publishes while playing, in ms. */
  publishIntervalMs: number;
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
export function useTimeVariableSync({
  store,
  isReady,
  enabled,
  mapping,
  whilePlaying,
  publishIntervalMs,
  peerSync,
}: Params): void {
  /** The window both sides last agreed on — the echo cutter. */
  const lastKey = useRef<string | undefined>(undefined);

  const mappingRef = useRef(mapping);
  const whilePlayingRef = useRef(whilePlaying);
  const peerSyncRef = useRef(peerSync);
  const publishIntervalRef = useRef(publishIntervalMs);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    mappingRef.current = mapping;
    whilePlayingRef.current = whilePlaying;
    peerSyncRef.current = peerSync;
    publishIntervalRef.current = publishIntervalMs;
  });

  /**
   * Whether the window is moving under a running clock rather than a hand.
   *
   * Local animation is the obvious case. The one that took a debugging session
   * to find is the other: with peer sync on, the map being played can be a
   * different panel entirely, and this one sees only its filter moving.
   */
  const clockRunning = useRef(() => isTimeFilterAnimating(store) || (peerSyncRef.current && timeChannel.anyPlaying()));

  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPublish = useRef<{ window: TimeRangeMs | null; domain: TimeRangeMs | null } | null>(null);
  /** When the run of changes now waiting to be published began. */
  const pendingSince = useRef<number | null>(null);
  /** Holds a playback publish until the panels answering the previous one are done; see PublishGate. */
  const gate = useRef(new PublishGate());
  /** True while the pending publish waits on the gate rather than on the interval. */
  const heldByGate = useRef(false);

  const publish = useRef(() => {
    publishTimer.current = null;
    const since = pendingSince.current;
    pendingSince.current = null;
    heldByGate.current = false;
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

    // While playing, a step also waits for the panels answering the previous
    // one, when a datasource on the page says when they are done. Only the
    // newest window is kept meanwhile; schedulePublish leaves the timer alone.
    const playing = clockRunning.current();
    if (playing) {
      const wait = gate.current.waitMs(performance.now());
      if (wait > 0) {
        pendingPublish.current = pending;
        pendingSince.current = since;
        heldByGate.current = true;
        publishTimer.current = setTimeout(() => publish.current(), wait);
        return;
      }
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
    if (playing) {
      gate.current.published(performance.now());
    } else {
      gate.current.reset();
    }
  });

  const schedulePublish = useRef((window: TimeRangeMs | null, domain: TimeRangeMs | null) => {
    pendingPublish.current = { window, domain };
    // Held by the gate, and still playing: keep only the newest window. The
    // gate's own timer, or the datasource settling, publishes it. Once the
    // clock has stopped — a local stop, a peer's, or a hand taking over — the
    // hold no longer applies, so the held step falls through to the ordinary
    // debounce/interval path below and the final window leaves as it always did.
    if (heldByGate.current && clockRunning.current()) {
      return;
    }
    heldByGate.current = false;
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
    //
    // The interval is a playback pace, so only a running clock gets it. A drag
    // keeps the default cap it has always had with this option on, so one that
    // never rests still writes every 1.5 s: a low interval would otherwise turn
    // its debounce into a throttle, one write per interval mid-drag.
    const cap = !whilePlayingRef.current
      ? Number.POSITIVE_INFINITY
      : clockRunning.current()
        ? publishIntervalRef.current
        : DEFAULT_PUBLISH_INTERVAL_MS;
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
    heldByGate.current = false;
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

      // Nothing to do and nothing to remember: `lastKey` stays as it was, so a
      // window arriving on a later pass is still read as the variables' first
      // word rather than as the map having moved.
      case 'wait':
        return;

      case 'toMap': {
        // Always a real window: `decideTimeSync` only asks for this direction
        // when the variables have one to give, so there is no falling back to
        // the domain here. A blank pair is a variable mid-recompute, not a
        // request to see everything.
        if (variableWindow && pushTimeRange(store, store.dispatch, variableWindow)) {
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
    // The DuckDB-WASM datasource, if it is on the page, says when the panels
    // it answers are done. A step held for them goes as soon as they are.
    const unsubscribeActivity = subscribeActivity((signal) => {
      gate.current.signal(signal);
      if (heldByGate.current && gate.current.waitMs(performance.now()) === 0) {
        if (publishTimer.current !== null) {
          clearTimeout(publishTimer.current);
        }
        publishTimer.current = setTimeout(() => publish.current(), 0);
      }
    });
    return () => {
      unsubscribeStore();
      unlisten();
      unsubscribeActivity();
      cancel();
    };
  }, [isReady, enabled, mapping.from, mapping.to, store]);
}

/** Both bound variables' current values, read from the URL. */
/**
 * The window the mapped variables describe right now, read from the URL.
 *
 * Exported for the timelines, which have to know whether anyone outside the map
 * has already said which moment to show before they widen the filter to the
 * whole dataset. Read from the location rather than from props for the reason
 * this whole module does: a variable change reaches a panel as a URL change,
 * and a render is not guaranteed to follow it.
 */
export function readVariableWindow(mapping: TimeVariableMapping | null): TimeRangeMs | null {
  if (!mapping?.from || !mapping.to) {
    return null;
  }
  return readWindowFromVariables(readVariables(mapping), mapping);
}

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
