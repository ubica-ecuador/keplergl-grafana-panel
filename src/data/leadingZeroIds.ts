import type { KeplerRow } from './toKeplerDataset';

/** As much of a kepler field as this needs to retype it. */
interface FieldLike {
  name: string;
  type: string;
  analyzerType?: string;
  format?: string;
}

/** A text value a number would change: a zero before another digit, as in "06047001901". */
const LEADING_ZERO = /^[+-]?0\d/;

/**
 * Keeps identifiers with leading zeros as the text they are.
 *
 * kepler types a column by its values, so a column of digit strings becomes an
 * integer, and `processCsvData` then parses every value: the census tract
 * "06047001901" reaches the map as 6047001901. A click publishes the number,
 * which no longer matches the query's own geoid, and a ZIP code, a FIPS or a
 * station code loses what makes it one. A column kepler typed as a number
 * while one of its values is text with a leading zero is turned back into a
 * string column holding the values the query sent. Other numeric text is still
 * parsed, as kepler intends: that is how a CSV's coordinates become numbers.
 *
 * Mutates `data`, as kepler's own processors do.
 */
export function keepLeadingZeroIds(
  data: { fields: FieldLike[]; rows: unknown[][] },
  source: readonly KeplerRow[]
): void {
  data.fields.forEach((field, index) => {
    if (field.type !== 'integer' && field.type !== 'real') {
      return;
    }
    const keeps = source.some((row) => {
      const value = row[field.name];
      return typeof value === 'string' && LEADING_ZERO.test(value.trim());
    });
    if (!keeps) {
      return;
    }
    field.type = 'string';
    field.analyzerType = 'STRING';
    field.format = '';
    source.forEach((row, r) => {
      if (data.rows[r]) {
        data.rows[r][index] = row[field.name];
      }
    });
  });
}
