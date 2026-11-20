import type { DataFrame } from '@grafana/data';

import { queryName } from '../data/rasterDataset';

/**
 * What the map says over itself about its queries (`MapNotices.tsx`).
 *
 * Three sources, all of which used to leave a map that simply showed nothing,
 * or less than asked:
 *
 * - **A query's error.** Grafana marks a failed query only with an icon in the
 *   panel's corner; the map went on drawing whatever the other queries gave.
 * - **A frame's notices of severity warning or error** (`meta.notices`), which a
 *   data source writes to say why its answer is not what was asked: the
 *   Spatial Catalog's "… is no longer in the catalog", "the service refused the
 *   time range", "This WFS does not publish that feature type". Grafana shows
 *   them in the same corner icon. Info notices are left there: a data source
 *   writes those about anything — a count, a conversion, a limit it kept — and
 *   on every refresh of every panel they would be noise over the map.
 * - **A layer the panel cannot draw from its columns**: tiles it does not draw
 *   yet (`framesToXyz`'s `onUndrawn`).
 *
 * Pure, so what is said and how it is worded can be tested without a map.
 */
export interface MapNotice {
  severity: 'error' | 'warning';
  text: string;
}

/** A message past this many characters is cut, whole in its tooltip: a stack trace is not read over a map. */
export const MAX_NOTICE_LENGTH = 300;

/** The query errors Grafana hands a panel, as notices: which query, and what it said. */
export function queryErrorNotices(
  errors: ReadonlyArray<{ refId?: string; message?: string; data?: { message?: string } }> | undefined
): MapNotice[] {
  // `errors` only: the older single `error` is the first of them on every
  // Grafana this panel runs on, and deprecated.
  return (errors ?? []).map((e) => {
    const message = String(e.data?.message || e.message || 'it failed').trim();
    return { severity: 'error', text: e.refId ? `Query ${e.refId}: ${message}` : message };
  });
}

/** Each frame's warning and error notices, named by its query. */
export function frameNotices(frames: readonly DataFrame[]): MapNotice[] {
  const notices: MapNotice[] = [];
  frames.forEach((frame, index) => {
    for (const notice of frame.meta?.notices ?? []) {
      if ((notice.severity === 'warning' || notice.severity === 'error') && notice.text?.trim()) {
        notices.push({
          severity: notice.severity,
          text: `${queryName(frame, frame.refId ?? `${index}`)}: ${notice.text.trim()}`,
        });
      }
    }
  });
  return notices;
}

/**
 * The notices in the order they are shown, each once: errors first, then
 * warnings, each in the order they came. A query whose error repeats in its
 * frame's notices is said once.
 */
export function orderNotices(...groups: MapNotice[][]): MapNotice[] {
  const seen = new Set<string>();
  const all = groups.flat().filter((notice) => !seen.has(notice.text) && seen.add(notice.text));
  return [...all.filter((n) => n.severity === 'error'), ...all.filter((n) => n.severity === 'warning')];
}
