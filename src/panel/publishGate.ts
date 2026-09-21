/**
 * Holds the map's next playback publish until the panels answering the
 * previous one have finished, when a datasource on the page says when that is.
 *
 * The signal is the DuckDB-WASM datasource's activity event: `busy` when it
 * starts answering, `settled` when it has nothing left. After a publish, the
 * gate waits a short grace for a `busy`. None means nothing local is answering
 * (a server datasource, or a Grafana without that plugin) and the gate opens,
 * so the pace is the publish interval alone. A `busy` holds the gate until the
 * `settled` that follows, or until the hold cap, so a signal that never comes
 * cannot stall playback.
 *
 * Pure and clock-free: callers pass performance.now() values, the clock the
 * datasource stamps its events with.
 */

/** How long after a publish a `busy` may take to arrive and still count. */
export const GATE_GRACE_MS = 250;

/** The longest the gate holds a publish, whatever the signals say. */
export const GATE_HOLD_MS = 5000;

export interface GateSignal {
  state: 'busy' | 'settled';
  /** performance.now() when the datasource changed state. */
  at: number;
}

export class PublishGate {
  private publishedAt: number | null = null;
  private busySince: number | null = null;
  private settled = false;

  constructor(
    private readonly grace = GATE_GRACE_MS,
    private readonly hold = GATE_HOLD_MS
  ) {}

  /** A playback step was just published at `at`. */
  published(at: number): void {
    this.publishedAt = at;
    this.busySince = null;
    this.settled = false;
  }

  /** Opens the gate until the next playback publish: playback stopped, or a publish came from a hand. */
  reset(): void {
    this.publishedAt = null;
    this.busySince = null;
    this.settled = false;
  }

  /** Feeds a datasource activity event. Events from before the last publish belong to an earlier step. */
  signal(event: GateSignal): void {
    if (this.publishedAt === null || event.at < this.publishedAt) {
      return;
    }
    if (event.state === 'busy') {
      this.busySince = event.at;
      this.settled = false;
    } else if (this.busySince !== null) {
      this.settled = true;
    }
  }

  /** 0 when the next publish may leave at `now`; otherwise how long to wait before asking again. */
  waitMs(now: number): number {
    if (this.publishedAt === null) {
      return 0;
    }
    const since = now - this.publishedAt;
    if (since >= this.hold) {
      return 0;
    }
    if (this.busySince === null) {
      return Math.max(0, this.grace - since);
    }
    return this.settled ? 0 : this.hold - since;
  }
}
