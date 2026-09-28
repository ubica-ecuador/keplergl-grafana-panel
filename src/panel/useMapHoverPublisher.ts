import { useEffect, useId, useRef } from 'react';
import type { EventBus } from '@grafana/data';
import { MapHoverPublisher } from './mapHoverPublisher';

export function useMapHoverPublisher(bus: EventBus | undefined, enabled: boolean, time: number | null) {
  const id = useId();
  const publisher = useRef<MapHoverPublisher | null>(null);
  useEffect(() => {
    if (!bus || !enabled) {
      return;
    }
    const current = new MapHoverPublisher(bus, `ubica-map-hover-${id}`);
    publisher.current = current;
    return () => {
      current.dispose();
      publisher.current = null;
    };
  }, [bus, enabled, id]);
  useEffect(() => {
    publisher.current?.move(time);
  }, [time, bus, enabled]);
}
