import { tableFromArrays } from 'apache-arrow';

import { EXPLORER_ROW_CAP, explorerSql, rowsFromTable } from './explorerQuery';

// ISO WKB for POINT(-79 -2.9), little-endian, as DuckDB's ST_AsHEXWKB prints it.
const POINT_HEX = '01010000000000000000C053C033333333333307C0';

describe('explorerSql', () => {
  it('caps the rows, asking for one more to tell a full result from a cut one', () => {
    expect(explorerSql({ sql: 'SELECT * FROM datasets.points' }, 10)).toBe(
      'SELECT * FROM (SELECT * FROM datasets.points) LIMIT 11'
    );
  });

  it('turns the geometry column into WKB hex, quoting its name', () => {
    expect(explorerSql({ sql: 'SELECT id, geom FROM t', geometryColumn: 'geom' }, 10)).toBe(
      'SELECT * FROM (SELECT * REPLACE (ST_AsHEXWKB("geom") AS "geom") FROM (SELECT id, geom FROM t)) LIMIT 11'
    );
    expect(explorerSql({ sql: 'SELECT 1', geometryColumn: 'the "shape"' }, 1)).toContain('ST_AsHEXWKB("the ""shape""")');
  });

  it('drops a trailing semicolon and whitespace before wrapping', () => {
    expect(explorerSql({ sql: '  SELECT 1 ;  \n' }, 5)).toBe('SELECT * FROM (SELECT 1) LIMIT 6');
  });

  it('defaults to the 200 000 row cap', () => {
    expect(EXPLORER_ROW_CAP).toBe(200_000);
    expect(explorerSql({ sql: 'SELECT 1' })).toMatch(/LIMIT 200001$/);
  });
});

describe('rowsFromTable', () => {
  it('passes columns through as plain values', () => {
    const table = tableFromArrays({ id: Int32Array.from([1, 2]), name: ['a', 'b'] });
    expect(rowsFromTable(table, undefined)).toEqual({
      rows: [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ],
      truncated: false,
    });
  });

  it('decodes the geometry column and hands it to kepler as _geojson', () => {
    const table = tableFromArrays({ id: Int32Array.from([1]), geom: [POINT_HEX] });
    const { rows } = rowsFromTable(table, 'geom');
    expect(rows[0]).not.toHaveProperty('geom');
    expect(rows[0]._geojson).toEqual({ type: 'Point', coordinates: [-79, expect.closeTo(-2.9, 6)] });
  });

  it('keeps a geometry value it cannot decode as it came', () => {
    const table = tableFromArrays({ geom: ['not wkb'] });
    expect(rowsFromTable(table, 'geom').rows[0]._geojson).toBe('not wkb');
  });

  it('cuts at the cap and says so', () => {
    const table = tableFromArrays({ id: Int32Array.from([1, 2, 3]) });
    expect(rowsFromTable(table, undefined, 2)).toEqual({ rows: [{ id: 1 }, { id: 2 }], truncated: true });
    expect(rowsFromTable(table, undefined, 3).truncated).toBe(false);
  });

  it('turns BigInt values into numbers kepler can use', () => {
    const table = tableFromArrays({ n: BigInt64Array.from([5n]) });
    expect(rowsFromTable(table, undefined).rows[0].n).toBe(5);
  });
});
