import { BusEventWithPayload } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import type { TimeRangeMs } from './timeSync';

/**
 * A time window on its way to a pair of dashboard variables, said on Grafana's event bus as it moves.
 *
 * A clock that writes the variables while it plays (the Kepler Plus Time Brush) writes them at most once per
 * interval, because each write runs every query that reads them; a map whose time filter follows those variables
 * would move in steps, a write at a time. So the clock also says here where its window is, every frame, and a
 * map bound to the same two variables moves its filter there at once, the variables catching up on their own
 * pace. Grafana's bus matches events by their `type` string, so the two plugins hear each other without
 * importing each other, as with the DuckDB-WASM activity event; the string and the payload are the contract.
 */
export interface TimeWindowSaid {
  /** The variables the window is written to: its start and its end. */
  variables: { from: string; to: string };
  window: TimeRangeMs;
  /** True while a clock moves it; false on the last word, once it stops, which is written to the variables too. */
  playing: boolean;
}

export class TimeWindowEvent extends BusEventWithPayload<TimeWindowSaid> {
  static type = 'ubica-time-window';
}

/** Says where the window is. Never throws. */
export function sayTimeWindow(said: TimeWindowSaid): void {
  try {
    getAppEvents().publish(new TimeWindowEvent(said));
  } catch {
    // No bus, no listeners.
  }
}

/** Calls `onSaid` for each window said that keeps the contract; the returned function unsubscribes. Never throws. */
export function subscribeTimeWindow(onSaid: (said: TimeWindowSaid) => void): () => void {
  try {
    const subscription = getAppEvents().subscribe(TimeWindowEvent, (event) => {
      const said = saidOf(event.payload);
      if (said) {
        onSaid(said);
      }
    });
    return () => subscription.unsubscribe();
  } catch {
    return () => undefined;
  }
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The payload, checked: the type string is public, on a bus every plugin on the page shares. */
function saidOf(payload: Partial<TimeWindowSaid> | null | undefined): TimeWindowSaid | null {
  const { variables, window, playing } = payload ?? {};
  if (
    typeof variables?.from !== 'string' ||
    typeof variables?.to !== 'string' ||
    !variables.from ||
    !variables.to ||
    !isTime(window?.from) ||
    !isTime(window?.to) ||
    window.from > window.to ||
    typeof playing !== 'boolean'
  ) {
    return null;
  }
  return {
    variables: { from: variables.from, to: variables.to },
    window: { from: window.from, to: window.to },
    playing,
  };
}
