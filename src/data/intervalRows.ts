/**
 * Rows that live from one moment to another: `valid_from` and `valid_to`, as the Spatial Catalog data source gives an
 * Iceberg table's history (each row with the commit it came at and the one it went at), and as slowly changing
 * dimensions are commonly written. A map keeps the rows alive at its time filter's moment, by kepler's end field
 * (`intervalFilters.ts`).
 */
const INTERVAL_START = 'valid_from';
const INTERVAL_END = 'valid_to';

/**
 * The pair in a kepler dataset: the start may have reached kepler as `time`, the name the panel gives the column of
 * the time role (the frame's first time column, `toKeplerDataset.ts`), which `valid_from` is when the query has no
 * time column before it.
 */
export function keplerIntervalPairOf(names: readonly string[]): { start: string; end: string } | null {
  if (!names.includes(INTERVAL_END)) {
    return null;
  }
  const start = names.includes(INTERVAL_START) ? INTERVAL_START : names.includes('time') ? 'time' : null;
  return start ? { start, end: INTERVAL_END } : null;
}
