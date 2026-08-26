import { useEffect, useMemo, useRef, useState } from 'react';

import { findTimeExtent, parseTimeExtent } from '../data/wmsCalendar';
import type { WmsDataset } from '../data/wmsDataset';
import { serviceCapabilities } from './wmsDeckLayer';

/**
 * Fills in the dates a WMS publishes, for queries that did not carry any.
 *
 * The hybrid the panel offers: a query that returns one row per date has said
 * which dates matter and wins outright — it may be a subset, or a catalogue
 * assembled from somewhere else entirely. A query that just names a service and
 * a layer gets a timeline anyway, read from the service's own
 * `<Dimension name="time">`.
 *
 * That second path is the one that keeps working by itself. A server gains a
 * new pass every day, and no query written by hand stays in step with it.
 *
 * Asked once per service and layer and then remembered, because the document
 * is large — 906 KB on the GeoGLOWS service — and shared with the layer's own
 * metadata fetch, so a page pays for it once whoever asks first.
 *
 * A service that answers nothing usable is recorded as having no dates, not
 * retried: the map then behaves as it does for any fixed layer, showing the
 * service's default slice. Retrying on every store change would hammer a
 * service that is simply not time-aware.
 */
export function useWmsCalendar(layers: WmsDataset[]): WmsDataset[] {
  const [calendars, setCalendars] = useState<Record<string, number[]>>({});
  const asked = useRef(new Set<string>());

  useEffect(() => {
    let live = true;

    for (const wms of layers) {
      // The query's own dates win; nothing to ask for.
      if (wms.times.length > 0) {
        continue;
      }
      const key = calendarKey(wms);
      if (asked.current.has(key)) {
        continue;
      }
      asked.current.add(key);

      serviceCapabilities(wms.serviceUrl)
        .then((capabilities) => {
          const extent = findTimeExtent(capabilities, wms.layerName);
          const times = extent ? parseTimeExtent(extent) : [];
          if (live) {
            setCalendars((known) => ({ ...known, [key]: times }));
          }
        })
        .catch(() => {
          if (live) {
            setCalendars((known) => ({ ...known, [key]: [] }));
          }
        });
    }

    return () => {
      live = false;
    };
  }, [layers]);

  return useMemo(
    () =>
      layers.map((wms) => {
        if (wms.times.length > 0) {
          return wms;
        }
        const times = calendars[calendarKey(wms)];
        return times?.length ? { ...wms, times } : wms;
      }),
    [layers, calendars]
  );
}

/** A service and one of its layers: what a calendar belongs to. */
function calendarKey(wms: WmsDataset): string {
  return `${wms.serviceUrl}|${wms.layerName}`;
}
