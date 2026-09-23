import type { Table } from 'apache-arrow';

import { KEPLER_COLUMN, type KeplerRow } from './toKeplerDataset';
import { wkbToGeometry } from './wkbToGeometry';

/** Rows the map takes from one explorer result; past this it loads the first ones and warns. */
export const EXPLORER_ROW_CAP = 200_000;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * The SQL the panel sends for an explorer request. A geometry column is turned
 * into WKB hex so it enters through the same decoder as a mapped geometry
 * column; the LIMIT asks for one row past the cap, which is how a result that
 * fills the cap is told apart from one that was cut.
 */
export function explorerSql(request: { sql: string; geometryColumn?: string }, cap = EXPLORER_ROW_CAP): string {
  const body = request.sql.trim().replace(/;+\s*$/, '').trim();
  const column = request.geometryColumn;
  const inner = column
    ? `SELECT * REPLACE (ST_AsHEXWKB(${quoteIdent(column)}) AS ${quoteIdent(column)}) FROM (${body})`
    : body;
  return `SELECT * FROM (${inner}) LIMIT ${cap + 1}`;
}

/** Row objects for kepler, at most `cap` of them; the geometry column decoded and named as kepler expects. */
export function rowsFromTable(
  table: Table,
  geometryColumn: string | undefined,
  cap = EXPLORER_ROW_CAP
): { rows: KeplerRow[]; truncated: boolean } {
  const count = Math.min(table.numRows, cap);
  const rows: KeplerRow[] = [];
  for (let i = 0; i < count; i++) {
    const source = table.get(i)?.toJSON() ?? {};
    const row: KeplerRow = {};
    for (const [name, value] of Object.entries(source)) {
      const plain = typeof value === 'bigint' ? Number(value) : value;
      if (name === geometryColumn) {
        row[KEPLER_COLUMN.geometry] = typeof plain === 'string' ? (wkbToGeometry(plain) ?? plain) : plain;
      } else {
        row[name] = plain;
      }
    }
    rows.push(row);
  }
  return { rows, truncated: table.numRows > cap };
}
