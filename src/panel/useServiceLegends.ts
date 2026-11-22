import { useEffect, useRef, useState } from 'react';
import type { Store } from 'redux';

import { type ServiceLegend, type ShownLegend, shownLegends } from '../data/serviceLegend';
import { readLayersShown } from './keplerAdapter';

interface Params {
  store: Store;
  isReady: boolean;
  /** The legends the queries name (`serviceLegends`). */
  legends: readonly ServiceLegend[];
}

const NONE: ShownLegend[] = [];

/**
 * The legends over the map that are shown now: those whose layer kepler draws
 * (`shownLegends`), titled with its label.
 *
 * Read from kepler's store, where the layer's eye in the layer panel lands, and
 * where a WMS whose timeline has no picture in the window is hidden
 * (`useWmsTimeline`): its legend goes with it. Recomputed on a microtask after
 * each store change, and changed in identity only when what is shown changes,
 * so a pan re-renders nothing.
 */
export function useServiceLegends({ store, isReady, legends }: Params): ShownLegend[] {
  const [shown, setShown] = useState<ShownLegend[]>(NONE);
  const legendsRef = useRef(legends);
  useEffect(() => {
    legendsRef.current = legends;
  });

  const said = useRef('');
  const reconcile = useRef(() => {
    const wanted = legendsRef.current;
    const next = wanted.length
      ? shownLegends(
          wanted,
          readLayersShown(
            store,
            wanted.map((legend) => legend.dataId)
          )
        )
      : NONE;
    const key = JSON.stringify(next);
    if (key !== said.current) {
      said.current = key;
      setShown(next.length ? next : NONE);
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

  useEffect(() => {
    if (!isReady) {
      return;
    }
    schedule.current();
    return store.subscribe(schedule.current);
  }, [isReady, store]);

  useEffect(() => {
    if (isReady) {
      schedule.current();
    }
  }, [isReady, legends]);

  return shown;
}
