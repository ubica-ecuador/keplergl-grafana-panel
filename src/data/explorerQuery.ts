import { DataType, util, type Table } from 'apache-arrow';

import { KEPLER_COLUMN, type KeplerRow } from './toKeplerDataset';
import { wkbToGeometry } from './wkbToGeometry';

/** Rows the map takes from one explorer result; past this it loads the first ones and warns. */
export const EXPLORER_ROW_CAP = 200_000;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Semicolons ending the query, with whatever whitespace and comments follow
 * them: a `;` inside the wrapper's parentheses is a syntax error. Every
 * alternative can match a stretch of text in one way only, so a failed match
 * cannot backtrack exponentially through a long `-- -----` rule.
 */
const TRAILING_SEMICOLONS = /;(?:[\s;]|--[^\n]*(?:\n|$)|\/\*(?:[^*]|\*(?!\/))*\*\/)*$/;

/** `sql` in parentheses, on lines of its own, so a trailing `--` comment ends before the `)`. */
const parenthesised = (sql: string) => `(\n${sql}\n)`;

/**
 * The SQL the panel sends for an explorer request. A geometry column is turned
 * into WKB hex so it enters through the same decoder as a mapped geometry
 * column; the LIMIT asks for one row past the cap, which is how a result that
 * fills the cap is told apart from one that was cut.
 */
export function explorerSql(request: { sql: string; geometryColumn?: string }, cap = EXPLORER_ROW_CAP): string {
  const body = request.sql.trim().replace(TRAILING_SEMICOLONS, '').trimEnd();
  const column = request.geometryColumn;
  const inner = column
    ? `SELECT * REPLACE (ST_AsHEXWKB(${quoteIdent(column)}) AS ${quoteIdent(column)}) FROM ${parenthesised(body)}`
    : body;
  return `SELECT * FROM ${parenthesised(inner)} LIMIT ${cap + 1}`;
}

type BigNum = Parameters<typeof util.bigNumToNumber>[0];

/**
 * A DECIMAL as a number, at its scale. DuckDB sends HUGEINT, which `SUM` of an
 * integer column returns, as Decimal(38, 0) too. Past 2^53 arrow refuses the
 * exact conversion; the nearest double is all kepler could hold anyway.
 */
function decimalToNumber(value: unknown, scale: number): number {
  try {
    return util.bigNumToNumber(value as BigNum, scale);
  } catch {
    return Number(util.bigNumToString(value as BigNum)) / 10 ** scale;
  }
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join('');

/** What JSON.stringify cannot write on its own: BigInts, and bytes, which it would spell out one by one. */
function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (value instanceof Uint8Array) {
    return hex(value);
  }
  return ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<unknown>) : value;
}

/**
 * A nested value ready for JSON.stringify. Lists and structs are walked by
 * their type so the decimals inside keep their scale; anything else (a map, an
 * interval) goes to JSON.stringify as arrow gives it, through `jsonSafe`.
 */
function jsonReady(type: DataType, value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (DataType.isDecimal(type)) {
    return decimalToNumber(value, type.scale);
  }
  if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
    const item = type.children[0].type;
    return Array.from(value as Iterable<unknown>, (element) => jsonReady(item, element));
  }
  if (DataType.isStruct(type)) {
    const struct = value as Record<string, unknown>;
    return Object.fromEntries(type.children.map((field) => [field.name, jsonReady(field.type, struct[field.name])]));
  }
  return value;
}

/**
 * How one column's values become something kepler can type: a number, a
 * string, a boolean or null. BigInts become numbers, decimals numbers at their
 * scale, bytes hex, and nested values (lists, structs, maps, intervals) JSON
 * text.
 */
function plainValue(type: DataType): (value: unknown) => unknown {
  if (DataType.isDecimal(type)) {
    return (value) => (value === null || value === undefined ? null : decimalToNumber(value, type.scale));
  }
  return (value) => {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (value === null || value === undefined || typeof value !== 'object') {
      return value ?? null;
    }
    if (value instanceof Uint8Array) {
      return hex(value);
    }
    return JSON.stringify(jsonReady(type, value), jsonSafe);
  };
}

/** Row objects for kepler, at most `cap` of them; the geometry column decoded and named as kepler expects. */
export function rowsFromTable(
  table: Table,
  geometryColumn: string | undefined,
  cap = EXPLORER_ROW_CAP
): { rows: KeplerRow[]; truncated: boolean } {
  const columns = table.schema.fields.map((field, index) => ({
    name: field.name,
    vector: table.getChildAt(index),
    plain: plainValue(field.type),
  }));
  const count = Math.min(table.numRows, cap);
  const rows: KeplerRow[] = [];
  for (let i = 0; i < count; i++) {
    const row: KeplerRow = {};
    for (const { name, vector, plain } of columns) {
      const value = plain(vector?.get(i));
      if (name === geometryColumn) {
        // The decoded geometry is the one object kepler takes as it is.
        row[KEPLER_COLUMN.geometry] = typeof value === 'string' ? (wkbToGeometry(value) ?? value) : value;
      } else {
        row[name] = value;
      }
    }
    rows.push(row);
  }
  return { rows, truncated: table.numRows > cap };
}
