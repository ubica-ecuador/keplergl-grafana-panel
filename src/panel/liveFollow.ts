import type { TimeRangeMs } from './timeSync';

/**
 * What the map's two clocks read at one moment, as `useLiveFollow` gathers it
 * from kepler: the trip animation playhead with its domain, and the time
 * filter's window with its domain.
 */
export interface LiveClocks {
  playhead: number | null;
  animationDomain: [number, number] | null;
  /** The trip animation is playing: the user is watching it run, not the edge. */
  animating: boolean;
  window: TimeRangeMs | null;
  domain: TimeRangeMs | null;
  /** The time filter is playing. */
  windowPlaying: boolean;
  /** The rows changed since the last reading: a refresh, not a hand on a clock. */
  dataChanged: boolean;
}

/** Where the clocks should go so the map shows the newest rows. */
export interface LiveMoves {
  playhead?: number;
  window?: TimeRangeMs;
}

/**
 * How close to the end of the data a clock may sit and still count as "at the
 * end": one second, or 1% of the data's span when that is more. kepler's
 * slider steps and the clamping of a pushed value both leave a clock a hair
 * short of the edge.
 */
export function endTolerance(span: number): number {
  return Math.max(1000, span * 0.01);
}

/**
 * Keeps the map on the newest rows while a query streams (Grafana Live, MQTT),
 * for as long as the user leaves it there.
 *
 * kepler opens a trip animation on the first instant of its data and never
 * moves it by itself, so a streaming map showed the oldest rows still in
 * Grafana's buffer and fell further behind with every message. Each refresh
 * here moves both clocks to the end of the new data, the playhead to its last
 * instant and the time filter's window to end there with the width it had.
 *
 * A clock the user moves away from the end stays where they put it, and is
 * followed again once they bring it back. The two are told apart by what else
 * changed: a refresh changes the rows, a hand on the slider does not. That
 * matters because a refresh also moves the clocks itself — replacing a
 * dataset sends kepler's playhead back to the start of its domain — and that
 * reset must not read as the user leaving the edge.
 *
 * A window that covered the whole domain keeps covering it as the domain grows,
 * rather than sliding: it showed everything, and should go on doing so.
 *
 * Pure: `useLiveFollow` reads kepler and applies the moves.
 */
export class LiveFollower {
  private followPlayhead = true;
  private followWindow = true;
  private lastPlayhead: number | null = null;
  private lastAnimationDomain: [number, number] | null = null;
  private lastWindow: TimeRangeMs | null = null;
  private lastDomain: TimeRangeMs | null = null;
  private windowWasWhole = true;

  /**
   * The moves for this reading. `moveWindow` is false when the dashboard time
   * range drives the filter (`toMap`, `bidirectional`): Grafana moves that
   * window itself, and a second hand on it would fight the first.
   */
  step(clocks: LiveClocks, moveWindow: boolean): LiveMoves {
    const moves: LiveMoves = {};
    const playhead = this.stepPlayhead(clocks);
    if (playhead !== undefined) {
      moves.playhead = playhead;
    }
    if (moveWindow) {
      const window = this.stepWindow(clocks);
      if (window) {
        moves.window = window;
      }
    }
    return moves;
  }

  /** What kepler settled on after the moves were applied, so it is not taken for a drag. */
  settled(playhead: number | null, window: TimeRangeMs | null): void {
    if (playhead !== null) {
      this.lastPlayhead = playhead;
    }
    if (window) {
      this.lastWindow = window;
    }
  }

  private stepPlayhead({ playhead, animationDomain, animating, dataChanged }: LiveClocks): number | undefined {
    if (!animationDomain) {
      // Mid-refresh: kepler has dropped the dataset and not taken the new rows yet.
      return undefined;
    }
    const [, end] = animationDomain;
    const tolerance = endTolerance(animationDomain[1] - animationDomain[0]);
    const domainMoved = !sameDomain(animationDomain, this.lastAnimationDomain);
    this.lastAnimationDomain = animationDomain;

    if (animating) {
      this.lastPlayhead = playhead;
      return undefined;
    }
    if (!dataChanged && !domainMoved) {
      // Only the playhead moved: the user's hand, which decides whether to follow.
      if (playhead !== null && playhead !== this.lastPlayhead) {
        this.followPlayhead = playhead >= end - tolerance;
      }
      this.lastPlayhead = playhead;
      return undefined;
    }
    this.lastPlayhead = playhead;
    if (!this.followPlayhead || (playhead !== null && Math.abs(playhead - end) < 1)) {
      return undefined;
    }
    return end;
  }

  private stepWindow({ window, domain, windowPlaying, dataChanged }: LiveClocks): TimeRangeMs | undefined {
    if (!window || !domain) {
      return undefined;
    }
    const tolerance = endTolerance(domain.to - domain.from);
    const domainMoved = !sameRange(domain, this.lastDomain);
    const previousDomain = this.lastDomain;
    this.lastDomain = domain;

    if (windowPlaying) {
      this.lastWindow = window;
      return undefined;
    }
    if (!dataChanged && !domainMoved) {
      if (!sameRange(window, this.lastWindow)) {
        this.followWindow = window.to >= domain.to - tolerance;
        this.windowWasWhole = this.followWindow && window.from <= domain.from + tolerance;
      }
      this.lastWindow = window;
      return undefined;
    }
    // The window as the user last left it: the refresh may have clamped or reset it.
    const before = this.lastWindow ?? window;
    this.lastWindow = window;
    if (!this.followWindow || !previousDomain) {
      if (!previousDomain) {
        this.windowWasWhole = window.from <= domain.from + tolerance && window.to >= domain.to - tolerance;
      }
      return undefined;
    }
    const next = this.windowWasWhole
      ? { from: domain.from, to: domain.to }
      : { from: Math.max(domain.from, domain.to - (before.to - before.from)), to: domain.to };
    return sameRange(next, window) ? undefined : next;
  }
}

function sameDomain(a: [number, number] | null, b: [number, number] | null): boolean {
  return a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
}

function sameRange(a: TimeRangeMs | null, b: TimeRangeMs | null): boolean {
  return a === b || (a !== null && b !== null && a.from === b.from && a.to === b.to);
}
