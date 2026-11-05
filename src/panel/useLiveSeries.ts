import { useEffect, useRef, useState } from 'react';
import type { DataFrame } from '@grafana/data';

/** The default least time between two map updates of a streaming query, in ms. */
export const DEFAULT_LIVE_INTERVAL_MS = 1000;
/** The least the editor allows. */
export const MIN_LIVE_INTERVAL_MS = 100;

/**
 * The query's frames, handed on at most once per `intervalMs` while they stream.
 *
 * A streaming query (Grafana Live, MQTT) hands the panel new frames with every
 * message, or every 200 ms when the datasource batches them. Each is a full
 * refresh of the map — kepler's `replaceDataInMap` empties the dataset and
 * builds it again — so 25 messages a second from Helsinki's buses kept the
 * browser busy 38% of the time for a couple of dozen vehicles. Positions
 * reported every second or so gain nothing from a faster map.
 *
 * The newest frames always win: an update due at the end of an interval takes
 * whatever arrived last, and none are dropped by being late. A hidden tab
 * takes no updates at all and catches up with the newest frames once it is
 * shown again.
 *
 * Frames with no rows do not start an interval. A stream opens on an empty
 * frame (the MQTT datasource sends its columns before its first message), and
 * held for a whole interval it was what kepler built the map on: no layer, the
 * view nowhere near the data, and the rows that came next arriving as a
 * second dataset that kepler adds no layer for.
 *
 * What is handed on is a copy, cut at each frame's length. Grafana does not
 * hand a streaming panel frames it can keep: the time column is the stream's
 * own buffer, which grows in place past the frame's length, and the columns a
 * transformation made (Extract fields, Add field from calculation) are emptied
 * when the next message runs the transformations again. Read a second later,
 * a held frame had its time and nothing else, and kepler built the map on
 * columns of nothing. A frame already emptied when its turn comes is skipped,
 * and the next one to arrive is taken at once.
 *
 * Frames that do not stream pass straight through, so a dashboard refresh is
 * never held back.
 */
export function useLiveSeries(series: DataFrame[], streaming: boolean, intervalMs: number): DataFrame[] {
  const [shown, setShown] = useState(series);
  const latest = useRef(series);
  const lastAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last flush found its frames emptied: take the next ones as soon as they come. */
  const retry = useRef(false);

  const flush = useRef(() => {
    timer.current = null;
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }
    const copy = snapshotFrames(latest.current);
    retry.current = copy === null;
    if (!copy) {
      return;
    }
    if (copy.some((frame) => frame.length > 0)) {
      lastAt.current = Date.now();
    }
    setShown(copy);
  });

  useEffect(() => {
    // Before the scheduling below, so a flush always takes these frames or newer.
    latest.current = series;
    if (!streaming || timer.current) {
      return;
    }
    const wait = retry.current ? 0 : lastAt.current + intervalMs - Date.now();
    if (wait <= 0) {
      flush.current();
    } else {
      timer.current = setTimeout(flush.current, wait);
    }
  }, [series, streaming, intervalMs]);

  useEffect(() => {
    if (!streaming || typeof document === 'undefined') {
      return;
    }
    const onVisible = () => {
      if (!document.hidden && !timer.current) {
        flush.current();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [streaming]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  return streaming ? shown : series;
}

/**
 * The frames with every column copied and cut at the frame's length, or null
 * when a column holds fewer values than the frame has rows: Grafana has
 * already emptied it for the next message (see `useLiveSeries`).
 */
export function snapshotFrames(series: DataFrame[]): DataFrame[] | null {
  const copies: DataFrame[] = [];
  for (const frame of series) {
    const fields = [];
    for (const field of frame.fields) {
      const values = field.values as ArrayLike<unknown>;
      if (values.length < frame.length) {
        return null;
      }
      fields.push({ ...field, values: Array.prototype.slice.call(values, 0, frame.length) });
    }
    copies.push({ ...frame, fields });
  }
  return copies;
}
