import { DataHoverClearEvent, DataHoverEvent, type EventBus } from '@grafana/data';

/** Publishes only pointer-derived times from the map. Received events are never forwarded. */
export class MapHoverPublisher {
  private frame: number | null = null;
  private ownsCursor = false;
  private lastTime: number | null = null;
  /**
   * A Time series answers a hover it receives by snapping its cursor to the
   * nearest sample and publishing that, tagged "uplot", synchronously inside our
   * own publish. That echo is not another panel taking over: taken as one, the
   * cursor was never cleared when the pointer left.
   */
  private publishing = false;
  private readonly subscriptions;

  constructor(
    private bus: EventBus,
    private tag: string
  ) {
    const release = (event: DataHoverEvent | DataHoverClearEvent) => {
      if (!this.publishing && !event.tags?.has(this.tag)) {
        // Another panel has taken over. Do not clear its cursor on our next leave/unmount.
        this.cancel();
        this.ownsCursor = false;
        this.lastTime = null;
      }
    };
    this.subscriptions = [
      bus.getStream(DataHoverEvent).subscribe(release),
      bus.getStream(DataHoverClearEvent).subscribe(release),
    ];
  }

  private cancel() {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  move(time: number | null) {
    this.cancel();
    if (time === null || !Number.isFinite(time)) {
      if (this.ownsCursor) {
        this.ownsCursor = false;
        this.lastTime = null;
        this.emit(new DataHoverClearEvent().setTags([this.tag]));
      }
      return;
    }
    if (this.ownsCursor && time === this.lastTime) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.ownsCursor = true;
      this.lastTime = time;
      // Do not tag this as "uplot": Time series ignores that tag to avoid chart echoes.
      this.emit(new DataHoverEvent({ point: { time } }).setTags([this.tag]));
    });
  }

  private emit(event: DataHoverEvent | DataHoverClearEvent) {
    this.publishing = true;
    try {
      this.bus.publish(event);
    } finally {
      this.publishing = false;
    }
  }

  dispose() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.move(null);
  }
}
