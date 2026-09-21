/**
 * Which rows of the map are the dashboard's selection, and where to mark them.
 *
 * The selection is what the click mappings have *published* — the variables in
 * the URL — not kepler's clicked entity, which a data refresh erases and a
 * shared link never had. Free of kepler, deck and React, so the rules can be
 * tested with literal values; `selectionHaloInput.ts` reads kepler into these
 * shapes and `selectionHaloDeckLayers.ts` draws what comes out.
 */

/** Column name → the values the dashboard has selected in it. */
export type Selection = Readonly<Record<string, readonly string[]>>;

/** One dataset, as much of it as the halo needs. */
export interface HaloDataset {
  fieldNames: readonly string[];
  numRows: number;
  valueAt: (row: number, column: number) => unknown;
  /**
   * What the row scan is cached on: kepler's `dataContainer`. Filtering copies
   * the dataset object (`copyTableAndUpdate`) but keeps this one, so a moving
   * clock does not rescan while a new query result does.
   */
  cacheKey: object;
}

/** The last scan of each data container: one selection at a time is enough. */
const scans = new WeakMap<object, { key: string; rows: readonly number[] }>();

/**
 * The rows whose value in any selected column is one of that column's values.
 *
 * A union over the columns: a panel mapping both a zone and a station marks the
 * selected station and every row of the selected zone. Values compare as
 * strings, the way the URL holds them, so the 13 in a row is the "13" of a
 * variable. Scanned once per data container and selection — the map repaints
 * on every pointer move, and a large dataset must not be walked each time.
 */
export function selectedRows(dataset: HaloDataset, selection: Selection): readonly number[] {
  const columns: Array<[number, ReadonlySet<string>]> = [];
  for (const [name, values] of Object.entries(selection)) {
    const index = dataset.fieldNames.indexOf(name);
    if (index >= 0 && values.length) {
      columns.push([index, new Set(values)]);
    }
  }
  if (!columns.length) {
    return [];
  }

  const key = JSON.stringify(columns.map(([index, values]) => [index, [...values].sort()]).sort());
  const last = scans.get(dataset.cacheKey);
  if (last?.key === key) {
    return last.rows;
  }

  const rows: number[] = [];
  for (let row = 0; row < dataset.numRows; row++) {
    for (const [index, values] of columns) {
      const value = dataset.valueAt(row, index);
      if (value !== null && value !== undefined && values.has(String(value))) {
        rows.push(row);
        break;
      }
    }
  }
  scans.set(dataset.cacheKey, { key, rows });
  return rows;
}
