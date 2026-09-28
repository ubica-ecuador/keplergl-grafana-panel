import { useEffect, useState } from 'react';
import { DataHoverEvent, DataHoverClearEvent, type EventBus } from '@grafana/data';

/** A visual cursor only: never writes to the dashboard range or kepler's clocks. */
export function useGrafanaHoverTime(eventBus: EventBus | undefined, enabled: boolean): number | null {
  const [cursor, setCursor] = useState({ eventBus, enabled, time: null as number | null });
  // Reset before rendering a newly enabled cursor or a replacement bus.
  if (cursor.eventBus !== eventBus || cursor.enabled !== enabled) {
    setCursor({ eventBus, enabled, time: null });
  }
  useEffect(() => {
    if (!enabled || !eventBus) {
      return;
    }
    let frame: number | null = null;
    let pending: number | null = null;
    const cancel = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    };
    const hover = eventBus.getStream(DataHoverEvent).subscribe((event) => {
      const value = event.payload.point.time;
      pending = typeof value === 'number' && Number.isFinite(value) ? value : null;
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          setCursor((previous) => (previous.time === pending ? previous : { eventBus, enabled, time: pending }));
        });
      }
    });
    const clear = eventBus.getStream(DataHoverClearEvent).subscribe(() => {
      cancel();
      pending = null;
      setCursor({ eventBus, enabled, time: null });
    });
    return () => {
      cancel();
      hover.unsubscribe();
      clear.unsubscribe();
    };
  }, [eventBus, enabled]);
  return enabled && cursor.eventBus === eventBus && cursor.enabled === enabled ? cursor.time : null;
}
