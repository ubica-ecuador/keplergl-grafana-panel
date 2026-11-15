import type { DataFrame } from '@grafana/data';

/**
 * Values a query hands the map as a column, once for the whole query: a Zarr's
 * colour ramp, a raster's band combination. The first row that has one wins,
 * so a query can return it on every row or only on the first.
 */

/** The column's first non-empty text, trimmed; undefined when the column is absent or empty. */
export function firstText(frame: DataFrame, column: string | undefined): string | undefined {
  const field = column ? frame.fields.find((f) => f.name === column) : undefined;
  if (!field) {
    return undefined;
  }
  for (let i = 0; i < frame.length; i++) {
    const raw = field.values[i];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return undefined;
}

const TRUE = new Set(['true', 't', '1', 'yes', 'y', 'on']);
const FALSE = new Set(['false', 'f', '0', 'no', 'n', 'off']);

/**
 * The column's first yes or no: a boolean, a number (0 is no), or a word
 * (true/false, yes/no, on/off, 1/0); undefined when the column is absent or no
 * row says either.
 */
export function firstFlag(frame: DataFrame, column: string | undefined): boolean | undefined {
  const field = column ? frame.fields.find((f) => f.name === column) : undefined;
  if (!field) {
    return undefined;
  }
  for (let i = 0; i < frame.length; i++) {
    const raw = field.values[i];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw !== 0;
    }
    if (typeof raw === 'string') {
      const word = raw.trim().toLowerCase();
      if (TRUE.has(word)) {
        return true;
      }
      if (FALSE.has(word)) {
        return false;
      }
    }
  }
  return undefined;
}
