import type { TimeRangeMs } from './timeSync';
import type { TimeWindowLink } from './pluginLinks';

/**
 * A time window on its way to a pair of dashboard variables, said as it moves.
 *
 * A clock that writes the variables while it plays (the Kepler Plus Time Brush) writes them at most once per
 * interval, because each write runs every query that reads them; a map whose time filter follows those variables
 * would move in steps, a write at a time. So the clock also says where its window is, every frame, and a map
 * bound to the same two variables moves its filter there at once, the variables catching up on their own pace.
 * The two hear each other through the Kepler Plus app's time window link (`pluginLinks.ts`), never by importing
 * each other; the payload is the contract, checked on arrival.
 */
export interface TimeWindowSaid {
  /** The variables the window is written to: its start and its end. */
  variables: { from: string; to: string };
  window: TimeRangeMs;
  /** True while a clock moves it; false on the last word, once it stops, which is written to the variables too. */
  playing: boolean;
}

/** Says where the window is, through `link` when there is one. Never throws. */
export function sayTimeWindow(link: TimeWindowLink | undefined, said: TimeWindowSaid): void {
  try {
    link?.say(said);
  } catch {
    // A link that fails says nothing.
  }
}

/** Calls `onSaid` for each window said that keeps the contract; the returned function unsubscribes. Never throws. */
export function subscribeTimeWindow(
  link: TimeWindowLink | undefined,
  onSaid: (said: TimeWindowSaid) => void
): () => void {
  if (!link) {
    return () => undefined;
  }
  try {
    const unsubscribe = link.subscribe((payload) => {
      const said = saidOf(payload as Partial<TimeWindowSaid> | null | undefined);
      if (said) {
        onSaid(said);
      }
    });
    return () => {
      try {
        unsubscribe();
      } catch {
        // Gone already.
      }
    };
  } catch {
    return () => undefined;
  }
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The payload, checked: it comes from another plugin. */
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
