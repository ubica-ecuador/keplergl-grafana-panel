import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { subscribeActivity } from './duckdbWasmActivity';
import { readAnimationTime, readIsAnimating, readSyncSlices } from './keplerAdapter';
import { playheadPhase, playheadWrite } from './playheadVariableSync';
import { PublishGate } from './publishGate';
import { SliceWatcher } from './sliceWatcher';
import { DEFAULT_PUBLISH_INTERVAL_MS, nextPublishDelay } from './timeVariableSync';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The variable the playhead is written to; empty for none. */
  variable: string;
  /** The least time between two writes while playing, in ms (defaulted and clamped). */
  publishIntervalMs: number;
}

/** How long a playhead moved by hand must rest before it is written, the same as the time filter's brush. */
const REST_MS = 300;

/**
 * Writes the trip animation's playhead to a dashboard variable, one way.
 *
 * kepler has two clocks: the time filter's window, which `useTimeVariableSync`
 * publishes, and the Trip layer's playhead (`animationConfig.currentTime`),
 * which until now only reached other maps over the peer channel. This is the
 * second one for every other panel: a chart can draw a bar at the instant the
 * map is playing, and a SQL panel can count what is on the road right then.
 *
 * - Playing: at most once per `publishIntervalMs`, and after the panels
 *   answering the previous write when a datasource on the page says when that
 *   is (`PublishGate`). Only the newest instant waits.
 * - Moved by hand, or by a peer map (this store never sees it playing): once it
 *   rests 300 ms, and every 1.5 s if it never does.
 * - Stopped: the final instant, straight away.
 *
 * The pacing is the one `useTimeVariableSync` has, repeated rather than shared:
 * that hook also carries the peer channel's playback, and is not worth putting
 * at risk for this. Same structural rule as every sync hook: reconcile on a
 * microtask, never inside the store subscription.
 */
export function usePlayheadVariableSync({ store, isReady, variable, publishIntervalMs }: Params): void {
  const variableRef = useRef(variable);
  const intervalRef = useRef(publishIntervalMs);
  useEffect(() => {
    variableRef.current = variable;
    intervalRef.current = publishIntervalMs;
  });

  /** The text last written, so the same instant is never written twice. */
  const lastWritten = useRef<string | null>(null);
  const wasAnimating = useRef(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  /** When the run of changes now waiting began. */
  const pendingSince = useRef<number | null>(null);
  const lastWriteAt = useRef<number | null>(null);
  const gate = useRef(new PublishGate());
  /** True while the pending write waits for the interval or the gate rather than for a rest. */
  const held = useRef(false);

  const write = useRef((value: string, playing: boolean) => {
    if (!variableRef.current) {
      return;
    }
    // Stamped before the write: the panels it sets off may report busy before partial() returns.
    if (playing) {
      gate.current.published(performance.now());
    } else {
      gate.current.reset();
    }
    lastWriteAt.current = Date.now();
    lastWritten.current = value;
    locationService.partial({ [`var-${variableRef.current}`]: value }, true);
  });

  const cancel = useRef(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    pendingSince.current = null;
    held.current = false;
  });

  /** 0 when a playback write may leave; otherwise how long it must still wait. */
  const playbackWait = useRef(() => {
    const sinceLast = lastWriteAt.current === null ? Number.POSITIVE_INFINITY : Date.now() - lastWriteAt.current;
    return Math.max(gate.current.waitMs(performance.now()), intervalRef.current - sinceLast);
  });

  const flush = useRef(() => {
    timer.current = null;
    const since = pendingSince.current;
    const value = pending.current;
    pendingSince.current = null;
    pending.current = null;
    held.current = false;
    if (value === null) {
      return;
    }
    const playing = readIsAnimating(store);
    if (playing) {
      const wait = playbackWait.current();
      if (wait > 0) {
        pending.current = value;
        pendingSince.current = since;
        held.current = true;
        timer.current = setTimeout(() => flush.current(), Math.min(wait, REST_MS));
        return;
      }
    }
    write.current(value, playing);
  });

  const schedule = useRef((value: string, playing: boolean) => {
    pending.current = value;
    // Held for the interval or the gate: keep only the newest instant.
    if (held.current && playing) {
      return;
    }
    held.current = false;
    const now = Date.now();
    if (pendingSince.current === null) {
      pendingSince.current = now;
    }
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    const cap = playing ? intervalRef.current : DEFAULT_PUBLISH_INTERVAL_MS;
    timer.current = setTimeout(() => flush.current(), nextPublishDelay(now, pendingSince.current, REST_MS, cap));
  });

  const reconcile = useRef(() => {
    if (!variableRef.current) {
      return;
    }
    const ms = readAnimationTime(store);
    if (ms === null) {
      return;
    }
    const animating = readIsAnimating(store);
    const phase = playheadPhase(animating, wasAnimating.current);
    wasAnimating.current = animating;

    if (phase === 'stopped') {
      cancel.current();
      const value = playheadWrite(ms, lastWritten.current);
      if (value !== null) {
        write.current(value, false);
      } else {
        gate.current.reset();
      }
      return;
    }

    const value = playheadWrite(ms, lastWritten.current);
    if (value === null) {
      return;
    }
    schedule.current(value, phase === 'playing');
  });

  const queued = useRef(false);
  const queue = useRef(() => {
    if (queued.current) {
      return;
    }
    queued.current = true;
    void Promise.resolve().then(() => {
      queued.current = false;
      reconcile.current();
    });
  });

  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (watcher.current.changed(readSyncSlices(store))) {
      queue.current();
    }
  });

  useEffect(() => {
    if (!isReady || !variable) {
      return;
    }
    const stop = cancel.current;
    queue.current();
    const unsubscribeStore = store.subscribe(onStoreChange.current);
    const unsubscribeActivity = subscribeActivity((signal) => {
      gate.current.signal(signal);
      if (held.current && playbackWait.current() === 0) {
        if (timer.current !== null) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => flush.current(), 0);
      }
    });
    return () => {
      unsubscribeStore();
      unsubscribeActivity();
      stop();
      // A new variable starts from nothing: its first write must not be skipped as a repeat.
      lastWritten.current = null;
    };
  }, [isReady, variable, store]);
}
