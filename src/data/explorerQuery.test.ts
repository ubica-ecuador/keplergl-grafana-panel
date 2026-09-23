import {
  Binary,
  Decimal,
  Field,
  Int32,
  Int64,
  List,
  makeData,
  makeVector,
  Struct,
  Table,
  tableFromArrays,
  Utf8,
  vectorFromArray,
} from 'apache-arrow';

import { EXPLORER_ROW_CAP, explorerSql, rowsFromTable } from './explorerQuery';

// ISO WKB for POINT(-79 -2.9), little-endian, as DuckDB's ST_AsHEXWKB prints it.
const POINT_HEX = '01010000000000000000C053C033333333333307C0';

/** A 128-bit Decimal column of `unscaled` values, the way DuckDB sends DECIMAL and HUGEINT. */
function decimals(unscaled: bigint[], scale: number, precision: number) {
  // Little-endian two's complement: the low 64 bits, then the high 64.
  const words = new BigInt64Array(unscaled.flatMap((v) => [BigInt.asIntN(64, v), BigInt.asIntN(64, v >> 64n)]));
  const type = new Decimal(scale, precision, 128);
  return makeVector(makeData({ type, length: unscaled.length, data: new Uint32Array(words.buffer) }));
}

describe('explorerSql', () => {
  /** Each line holding a `--` comment is followed by one that closes a parenthesis, and LIMIT ends the query. */
  function expectCommentsClosed(sql: string, cap: number) {
    const lines = sql.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('--')) {
        expect(lines[i + 1]).toMatch(/^\)/);
      }
    });
    expect(lines.at(-1)).toBe(`) LIMIT ${cap + 1}`);
  }

  it('caps the rows, asking for one more to tell a full result from a cut one', () => {
    expect(explorerSql({ sql: 'SELECT * FROM datasets.points' }, 10)).toBe(
      'SELECT * FROM (\nSELECT * FROM datasets.points\n) LIMIT 11'
    );
  });

  it('turns the geometry column into WKB hex, quoting its name', () => {
    expect(explorerSql({ sql: 'SELECT id, geom FROM t', geometryColumn: 'geom' }, 10)).toBe(
      'SELECT * FROM (\nSELECT * REPLACE (ST_AsHEXWKB("geom") AS "geom") FROM (\nSELECT id, geom FROM t\n)\n) LIMIT 11'
    );
    expect(explorerSql({ sql: 'SELECT 1', geometryColumn: 'the "shape"' }, 1)).toContain(
      'ST_AsHEXWKB("the ""shape""")'
    );
  });

  it('drops trailing semicolons and whitespace before wrapping', () => {
    expect(explorerSql({ sql: '  SELECT 1 ;  \n' }, 5)).toBe('SELECT * FROM (\nSELECT 1\n) LIMIT 6');
    expect(explorerSql({ sql: 'SELECT 1;;\n ;' }, 5)).toBe('SELECT * FROM (\nSELECT 1\n) LIMIT 6');
  });

  it('ends a trailing line comment before the parenthesis and the LIMIT', () => {
    const sql = explorerSql({ sql: 'SELECT * FROM t -- note' }, 10);
    expect(sql).toBe('SELECT * FROM (\nSELECT * FROM t -- note\n) LIMIT 11');
    expectCommentsClosed(sql, 10);

    const withGeometry = explorerSql({ sql: 'SELECT geom FROM t -- note', geometryColumn: 'geom' }, 10);
    expect(withGeometry).toContain('SELECT geom FROM t -- note\n)');
    expectCommentsClosed(withGeometry, 10);
  });

  it('drops a semicolon that has comments after it', () => {
    expect(explorerSql({ sql: 'SELECT 1; -- x' }, 5)).toBe('SELECT * FROM (\nSELECT 1\n) LIMIT 6');
    expect(explorerSql({ sql: 'SELECT 1; -- x; y\n-- z\n' }, 5)).toBe('SELECT * FROM (\nSELECT 1\n) LIMIT 6');
    expect(explorerSql({ sql: 'SELECT 1; /* x; */ ' }, 5)).toBe('SELECT * FROM (\nSELECT 1\n) LIMIT 6');
  });

  it('leaves a semicolon alone when SQL follows it, and a comment that holds one', () => {
    expect(explorerSql({ sql: "SELECT ';' AS s" }, 5)).toBe("SELECT * FROM (\nSELECT ';' AS s\n) LIMIT 6");
    const sql = explorerSql({ sql: 'SELECT 1 -- a; b' }, 5);
    expect(sql).toBe('SELECT * FROM (\nSELECT 1 -- a; b\n) LIMIT 6');
    expectCommentsClosed(sql, 5);
  });

  it('gets through a long comment rule after a semicolon without backtracking', () => {
    const rule = `-- ${'-'.repeat(60)}`;
    expect(explorerSql({ sql: `SELECT 1; ${rule}\nFROM t` }, 5)).toContain(`${rule}\nFROM t\n)`);
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

  it('reads a DECIMAL at its scale', () => {
    const table = new Table({ price: decimals([12345n, -12345n], 2, 10) });
    expect(rowsFromTable(table, undefined).rows.map((row) => row.price)).toEqual([123.45, -123.45]);
  });

  it('reads a HUGEINT, which arrives as Decimal(38, 0), as a number, even past 2^53', () => {
    const table = new Table({ total: decimals([42n, 2n ** 64n], 0, 38) });
    expect(rowsFromTable(table, undefined).rows.map((row) => row.total)).toEqual([42, 2 ** 64]);
  });

  it('turns nested values into JSON text and bytes into hex, so kepler never gets an object', () => {
    const table = new Table({
      ids: vectorFromArray([[1, 2]], new List(new Field('item', new Int32()))),
      big: vectorFromArray([[7n]], new List(new Field('item', new Int64()))),
      prices: makeVector(
        makeData({
          type: new List(new Field('item', new Decimal(2, 10, 128))),
          length: 1,
          valueOffsets: Int32Array.from([0, 1]),
          child: decimals([150n], 2, 10).data[0],
        })
      ),
      place: vectorFromArray([{ a: 1, b: 'x' }], new Struct([new Field('a', new Int32()), new Field('b', new Utf8())])),
      blob: vectorFromArray([Uint8Array.from([1, 171])], new Binary()),
    });
    expect(rowsFromTable(table, undefined).rows[0]).toEqual({
      ids: '[1,2]',
      big: '[7]',
      prices: '[1.5]',
      place: '{"a":1,"b":"x"}',
      blob: '01AB',
    });
  });

  it('keeps nulls as null', () => {
    const table = new Table({ ids: vectorFromArray([null], new List(new Field('item', new Int32()))) });
    expect(rowsFromTable(table, undefined).rows[0].ids).toBeNull();
  });
});
