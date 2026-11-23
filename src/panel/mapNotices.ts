import type { DataFrame } from '@grafana/data';

import { detectFields, type FieldRoleOverrides, type FieldRoles, resolveRoles } from '../data/detectFields';
import { queryName } from '../data/rasterDataset';
import { serviceKindOf } from '../data/serviceKind';

/**
 * What the map says over itself about its queries (`MapNotices.tsx`).
 *
 * Four sources, all of which used to leave a map that simply showed nothing,
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
 *   yet (`framesToXyz`'s `onUndrawn`), and a catalog's service row that gives
 *   nothing to draw at all (`undrawnServiceNotices`).
 * - **Rows the dashboard's time range hides, every one of them**: the time
 *   filter that follows the range leaves nothing on the map
 *   (`outOfRangeNotices`, read from kepler's store by `useTimeRangeNotices`).
 *
 * Pure, so what is said and how it is worded can be tested without a map.
 */
export interface MapNotice {
  severity: 'error' | 'warning';
  text: string;
}

/** A message past this many characters is cut, whole in its tooltip: a stack trace is not read over a map. */
export const MAX_NOTICE_LENGTH = 300;

/** A query's error as Grafana hands it to a panel: `DataQueryError`, as far as it is read. */
type QueryError = { refId?: string; message?: string; data?: { message?: string } };

/** The query errors Grafana hands a panel, as notices: which query, and what it said. */
export function queryErrorNotices(errors: readonly QueryError[] | undefined, error?: QueryError): MapNotice[] {
  // The list, and the older single `error` when the list is empty. Not a
  // nicety: a data source that throws reaches the panel through Grafana's
  // runRequest `catchError`, which sets `error` alone (Grafana 13.3), so a
  // panel whose only query threw had its error in `error` and none in
  // `errors`. Only one of them otherwise: Grafana fills `error` with the first
  // of `errors` when it gets a list.
  const list = errors?.length ? errors : error ? [error] : [];
  return list.map((e) => {
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
 * Each query whose rows name a map service of which the map draws nothing, as
 * a warning: the Spatial Catalog's Services row of a WMTS layer whose format is
 * not a picture (an elevation in `image/x-bil`) comes with no `tiles_url`,
 * `esri_url` or `wms_url`, only its protocol in `service`, its address and its
 * title, and the map stayed empty without a word.
 *
 * A query is said when it has a `service` column with a value, no row names a
 * service the map draws (`serviceKindOf`), and nothing else in it is drawn: no
 * coordinates, geometry, cells or places, no Zarr store. Named by its first
 * row with a protocol, and that row's `title`.
 */
export function undrawnServiceNotices(
  frames: readonly DataFrame[],
  overrides: Record<string, FieldRoleOverrides> = {}
): MapNotice[] {
  const notices: MapNotice[] = [];
  frames.forEach((frame, index) => {
    const services = frame.fields.find((field) => field.name === 'service');
    const row = services ? services.values.findIndex((value) => protocolOf(value) !== null) : -1;
    if (!services || row < 0) {
      return;
    }
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), overrides[refId]);
    if (serviceKindOf(frame, roles) !== null || drawsRows(roles)) {
      return;
    }
    const title = frame.fields.find((field) => field.name === 'title')?.values[row];
    notices.push({
      severity: 'warning',
      text:
        `${queryName(frame, refId)} gives a ${protocolName(protocolOf(services.values[row])!)} service` +
        `${named(title) ? ` (${String(title).trim()})` : ''} with nothing this map draws: ` +
        'no tiles_url, no esri_url, no wms_url with its wms_layer.',
    });
  });
  return notices;
}

/** Whether a query's rows are drawn by themselves, a service or not: they say where they are. */
function drawsRows(roles: FieldRoles): boolean {
  return Boolean(
    (roles.latitude && roles.longitude) ||
    (roles.originLat && roles.originLng) ||
    roles.geometry ||
    roles.h3 ||
    roles.originH3 ||
    roles.geohash ||
    roles.lookup ||
    roles.zarrUrl
  );
}

/**
 * A row's protocol from its `service` value: the word itself (a Services frame's `wms`), or the `protocol` of a
 * service written whole as JSON (a Catalog search frame's `{"protocol":"wms","layers":[…],…}`, which was put in the
 * notice as it stood). Null for an empty value, or JSON that names none.
 */
function protocolOf(value: unknown): string | null {
  if (!named(value)) {
    return null;
  }
  const text = String(value).trim();
  if (!text.startsWith('{')) {
    return text;
  }
  try {
    const protocol = (JSON.parse(text) as { protocol?: unknown }).protocol;
    return named(protocol) ? String(protocol).trim() : null;
  } catch {
    return null;
  }
}

/** A protocol as people write it: `wmts` is WMTS; a longer name stays as the catalog gives it. */
function protocolName(protocol: string): string {
  const name = protocol.trim();
  return /^[a-z0-9]{2,6}$/i.test(name) ? name.toUpperCase() : name;
}

function named(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** The times of one dataset under the map's time filter, as kepler maps them: epoch ms, null where a row has none. */
export interface FilteredTimes {
  /** The dataset id, `grafana-<refId>` for a query's rows. */
  dataId: string;
  label: string;
  times: readonly unknown[];
}

/** Each dataset's times, finite and sorted, once per array kepler hands over. */
const sortedTimes = new WeakMap<readonly unknown[], Float64Array>();

function sortedOf(times: readonly unknown[]): Float64Array {
  let sorted = sortedTimes.get(times);
  if (!sorted) {
    sorted = Float64Array.from(times.filter((t): t is number => typeof t === 'number' && Number.isFinite(t))).sort();
    sortedTimes.set(times, sorted);
  }
  return sorted;
}

/** Whether any of the sorted times is within the range, ends included: the first at or after its start. */
function anyWithin(sorted: Float64Array, from: number, to: number): boolean {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < from) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low < sorted.length && sorted[low] <= to;
}

/**
 * Each query whose rows all fall outside the dashboard's time range, as a
 * warning: the time filter that follows the range (`useTimeRangeSync`) hides
 * every one of them, and the map is empty with no word why — Madrid's fountains,
 * inspected from 2017 to 2025, under "Last 7 days". Said with the rows' span,
 * first to last, as `formatTime` writes a moment; gone as soon as the range
 * covers one of them again. A query with no timed row is not said: there is
 * nothing the range could show.
 *
 * The times are sorted once per array kepler hands over, so a store change
 * that leaves the rows alone costs a binary search per query.
 */
export function outOfRangeNotices(
  sets: readonly FilteredTimes[],
  range: { from: number; to: number },
  formatTime: (ms: number, span: number) => string
): MapNotice[] {
  const notices: MapNotice[] = [];
  for (const { dataId, label, times } of sets) {
    const sorted = sortedOf(times);
    if (sorted.length === 0 || anyWithin(sorted, range.from, range.to)) {
      continue;
    }
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last - first;
    const refId = /^grafana-(.+)$/.exec(dataId)?.[1];
    const name = refId && label !== `Query ${refId}` && label !== refId ? `${label} (query ${refId})` : label;
    notices.push({
      severity: 'warning',
      text:
        sorted.length === 1
          ? `${name}: its one row, at ${formatTime(first, span)}, falls outside the dashboard's time range. ` +
            'Widen the range to see it.'
          : `${name}: its ${sorted.length.toLocaleString('en-US')} rows all fall outside the dashboard's time ` +
            `range: they run from ${formatTime(first, span)} to ${formatTime(last, span)}. Widen the range to see them.`,
    });
  }
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
