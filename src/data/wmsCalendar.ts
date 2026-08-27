/**
 * The dates a WMS says it has, read from its capabilities document.
 *
 * A time-aware WMS publishes its own calendar — `<Dimension name="time">` on
 * each layer — so a query does not have to carry one. That matters because the
 * two things a dashboard author would otherwise have to keep in step, the dates
 * in the query and the dates on the server, cannot be kept in step: the server
 * gains a new pass every day.
 *
 * Only the parsing lives here, free of any fetch, so the awkward part — an
 * extent in two quite different shapes — can be tested with literal strings.
 */

/** Ceiling on how many instants one extent may expand to. See {@link parseTimeExtent}. */
const DEFAULT_LIMIT = 2000;

/**
 * The instants an extent describes, oldest first, in epoch ms.
 *
 * WMS allows two shapes and servers disagree about which to use, so both are
 * read. GeoServer writes every date out — `a,b,c` — which is verbose (14 389
 * of them on GeoGLOWS' hourly layers) but exact. MapServer and NASA's GIBS
 * write `start/end/period`, which is compact and has to be expanded here.
 *
 * An extent that cannot be read yields nothing rather than a guess: `current`
 * is a legal value in some deployments, and inventing dates for it would put a
 * timeline on the map that the server would answer with empty tiles.
 *
 * The `limit` is not a nicety. `2016-01-01/2026-01-01/PT1S` is a legal extent
 * and three hundred million instants; expanded whole it would be a redux store
 * full of numbers and a browser that never comes back. When it bites, the
 * *newest* end is kept, because that is the end a map opens on.
 */
export function parseTimeExtent(extent: string, limit: number = DEFAULT_LIMIT): number[] {
  const instants = new Set<number>();

  for (const part of extent.split(',')) {
    const piece = part.trim();
    if (!piece) {
      continue;
    }
    if (piece.includes('/')) {
      for (const time of expandInterval(piece, limit)) {
        instants.add(time);
      }
      continue;
    }
    const time = Date.parse(piece);
    if (Number.isFinite(time)) {
      instants.add(time);
    }
  }

  const sorted = [...instants].sort((a, b) => a - b);
  return sorted.length > limit ? sorted.slice(sorted.length - limit) : sorted;
}

/**
 * The instants an ISO 8601 `start/end/period` triple stands for.
 *
 * The walk starts at whichever step leaves `limit` instants before the end,
 * rather than at the beginning: an extent too long to expand is nearly always a
 * long history whose recent end is the interesting one, and a map opens on the
 * newest date it has. Filling the array from 2016 and stopping in 2017 would be
 * a timeline of the wrong decade.
 *
 * The step count is an upper bound, not an exact answer — with a period mixing
 * months and hours the two bounds disagree and the smaller is taken. The loop
 * then stops at `end` regardless, so an over-estimate costs a few instants of
 * the allowance and never a wrong date.
 */
function expandInterval(interval: string, limit: number): number[] {
  const [startText, endText, periodText] = interval.split('/');
  const start = Date.parse(startText ?? '');
  const end = Date.parse(endText ?? '');
  const period = parseDuration(periodText ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || !period || end < start) {
    return [];
  }

  const first = Math.max(0, stepsBetween(start, end, period) - limit + 1);
  const times: number[] = [];
  for (let step = first; times.length < limit; step++) {
    const at = advance(start, period, step);
    if (!Number.isFinite(at) || at > end) {
      break;
    }
    times.push(at);
  }
  return times;
}

/** An upper bound on how many periods fit between two instants. */
function stepsBetween(start: number, end: number, period: Duration): number {
  const bounds: number[] = [];
  if (period.ms > 0) {
    bounds.push(Math.floor((end - start) / period.ms));
  }
  if (period.months > 0) {
    const from = new Date(start);
    const to = new Date(end);
    const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    bounds.push(Math.floor(months / period.months));
  }
  return bounds.length ? Math.max(0, Math.min(...bounds)) : 0;
}

/** A period, split into the part the calendar decides and the part arithmetic does. */
interface Duration {
  months: number;
  ms: number;
}

/**
 * Reads an ISO 8601 duration — `P1D`, `PT1H`, `P1M`, `P1Y6M`.
 *
 * Months and years are kept apart from everything else because they are not
 * quantities of time: a month is between 28 and 31 days depending on where you
 * start. Treating `P1M` as 30 days is how a monthly series ends up drifting off
 * the first of the month by March.
 *
 * A duration of zero is refused: as a period it would describe an infinite
 * series of the same instant.
 */
function parseDuration(text: string): Duration | null {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(
    text.trim()
  );
  if (!match) {
    return null;
  }

  const [, years, months, weeks, days, hours, minutes, seconds] = match.map((value) =>
    value === undefined ? 0 : Number(value)
  ) as unknown as number[];

  const duration = {
    months: years * 12 + months,
    ms: ((weeks * 7 + days) * 24 * 3600 + hours * 3600 + minutes * 60) * 1000 + seconds * 1000,
  };
  return duration.months === 0 && duration.ms === 0 ? null : duration;
}

/**
 * The instant `step` periods after `start`.
 *
 * Computed from the start every time rather than by adding to the previous
 * result, so a calendar month landing on a shorter month — 31 January plus a
 * month is 28 February — does not drag every later date along with it.
 */
function advance(start: number, period: Duration, step: number): number {
  const at = new Date(start + period.ms * step);
  if (period.months) {
    const day = at.getUTCDate();
    at.setUTCMonth(at.getUTCMonth() + period.months * step);
    // Overflowed into the next month (31 January + 1 month): walk back to the
    // last day of the month meant.
    if (at.getUTCDate() !== day) {
      at.setUTCDate(0);
    }
  }
  return at.getTime();
}

/** A capabilities document, in the shape loaders.gl parses it into. */
interface CapabilitiesLike {
  layers?: ServiceLayer[];
}

interface ServiceLayer {
  name?: string;
  layers?: ServiceLayer[];
  dimensions?: Array<{ name?: string; extent?: string }>;
}

/**
 * The raw time extent a named layer publishes, or null if it publishes none.
 *
 * Layers nest — a WMS groups them, and a group's children inherit what it
 * declares — so the search walks the tree rather than the top level. Kept here,
 * away from the fetch, because the awkward part is the shape of the document
 * and that can be handed to a test as a literal.
 *
 * Nothing else in the plugin reads a capabilities document: kepler parses one
 * of its own for the layer list, and throws the dimensions away.
 */
export function findTimeExtent(capabilities: unknown, layerName: string): string | null {
  const walk = (layers: ServiceLayer[] | undefined): ServiceLayer | null => {
    for (const layer of layers ?? []) {
      if (layer.name === layerName) {
        return layer;
      }
      const nested = walk(layer.layers);
      if (nested) {
        return nested;
      }
    }
    return null;
  };

  const found = walk((capabilities as CapabilitiesLike | null)?.layers);
  const time = found?.dimensions?.find((dimension) => dimension.name === 'time');
  return time?.extent?.trim() || null;
}
