import { useEffect, useRef, useState } from 'react';
import { dateTimeFormat } from '@grafana/data';
import type { Store } from 'redux';

import { readTimeFilterTimes } from './keplerAdapter';
import { type MapNotice, outOfRangeNotices } from './mapNotices';
import { couplesDashboardRange, type TimeRangeMs, type TimeSyncMode } from './timeSync';

/** Past two days the rows' span reads in days; within them, to the minute. */
const DAYS_MS = 2 * 24 * 60 * 60 * 1000;

interface Params {
  store: Store;
  isReady: boolean;
  /** Only a mode that ties the map's time filter to the dashboard's range hides rows by it. */
  mode: TimeSyncMode;
  /** The dashboard time range, in epoch ms. */
  grafanaRange: TimeRangeMs;
  /** The dashboard's time zone, which the rows' span is written in. */
  timeZone?: string;
}

const NONE: MapNotice[] = [];

/**
 * The queries whose rows the dashboard's time range hides, every one of them
 * (`outOfRangeNotices`), for the notices over the map.
 *
 * Read from kepler's store, where the time filter says which datasets and which
 * of their fields it filters: the rows it hides are those, not every query with
 * a time column. Recomputed on a microtask after each store change and each
 * change of the range; the notices change identity only when what they say
 * does, so a pan re-renders nothing.
 */
export function useTimeRangeNotices({ store, isReady, mode, grafanaRange, timeZone }: Params): MapNotice[] {
  const [notices, setNotices] = useState<MapNotice[]>(NONE);
  const params = useRef({ mode, grafanaRange, timeZone });
  useEffect(() => {
    params.current = { mode, grafanaRange, timeZone };
  });

  const said = useRef('');
  const reconcile = useRef(() => {
    const { mode, grafanaRange, timeZone } = params.current;
    const next = couplesDashboardRange(mode)
      ? outOfRangeNotices(readTimeFilterTimes(store), grafanaRange, (ms, span) =>
          dateTimeFormat(ms, { timeZone, format: span >= DAYS_MS ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm' })
        )
      : NONE;
    const key = next.map((notice) => notice.text).join('\n');
    if (key !== said.current) {
      said.current = key;
      setNotices(next.length ? next : NONE);
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
  }, [isReady, mode, grafanaRange.from, grafanaRange.to, timeZone]);

  return notices;
}
