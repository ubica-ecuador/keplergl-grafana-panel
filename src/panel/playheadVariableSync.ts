import { formatTimeValue } from './timeVariableSync';

/**
 * The trip playhead as a dashboard variable: the decisions, free of React and
 * kepler so they test with plain values. The hook that acts on them is
 * `usePlayheadVariableSync`.
 */

/** Where the clock is, as the hook needs to tell a stop from a rest. */
export type PlayheadPhase = 'playing' | 'stopped' | 'idle';

/**
 * The text to write for the playhead at `ms`, or null when there is nothing to
 * write: the instant is not a number, or it would repeat the last write.
 *
 * Compared as text, not as a number, because the text is what reaches the
 * dashboard: kepler recomputes the same instant with a fraction of a
 * millisecond, and a write per recomputation would re-run every panel reading
 * the variable for nothing.
 */
export function playheadWrite(ms: number, lastWritten: string | null): string | null {
  if (!Number.isFinite(ms)) {
    return null;
  }
  const text = formatTimeValue(ms);
  return text === lastWritten ? null : text;
}

/** Whether the clock is running, has just stopped, or was already still. */
export function playheadPhase(isAnimating: boolean, wasAnimating: boolean): PlayheadPhase {
  if (isAnimating) {
    return 'playing';
  }
  return wasAnimating ? 'stopped' : 'idle';
}
