import { wkbToGeoJson } from './wkbToGeoJson';

// Fixtures generated with shapely 2.1.2:
//   hex     = shapely.to_wkb(geom, hex=True, include_srid=…, flavor=…)
//   geojson = shapely.geometry.mapping(geom)

function parse(hex: string) {
  const gj = wkbToGeoJson(hex);
  return gj && JSON.parse(gj);
}

describe('wkbToGeoJson', () => {
  it('decodes a 2D point with SRID', () => {
    // POINT (1 2), SRID=4326
    expect(parse('0101000020E6100000000000000000F03F0000000000000040')).toEqual({
      type: 'Point',
      coordinates: [1, 2],
    });
  });

  it('keeps the Z coordinate', () => {
    // POINT Z (1 2 3), SRID=4326
    expect(parse('01010000A0E6100000000000000000F03F00000000000000400000000000000840')).toEqual({
      type: 'Point',
      coordinates: [1, 2, 3],
    });
  });

  it('decodes a linestring', () => {
    // LINESTRING (0 0, 1 1, 2 2), SRID=4326
    expect(
      parse(
        '0102000020E61000000300000000000000000000000000000000000000000000000000F03F000000000000F03F00000000000000400000000000000040'
      )
    ).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] });
  });

  it('decodes a polygon with its ring', () => {
    // POLYGON ((0 0,0 1,1 1,1 0,0 0)), SRID=4326
    expect(
      parse(
        '0103000020E61000000100000005000000000000000000000000000000000000000000000000000000000000000000F03F000000000000F03F000000000000F03F000000000000F03F000000000000000000000000000000000000000000000000'
      )
    ).toEqual({ type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] });
  });

  it('decodes a multipolygon', () => {
    // MULTIPOLYGON (((0 0,0 1,1 1,1 0,0 0)),((2 2,2 3,3 3,3 2,2 2))), SRID=4326
    expect(
      parse(
        '0106000020E61000000200000001030000000100000005000000000000000000000000000000000000000000000000000000000000000000F03F000000000000F03F000000000000F03F000000000000F03F000000000000000000000000000000000000000000000000010300000001000000050000000000000000000040000000000000004000000000000000400000000000000840000000000000084000000000000008400000000000000840000000000000004000000000000000400000000000000040'
      )
    ).toEqual({
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        [[[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]]],
      ],
    });
  });

  it('decodes a geometry collection', () => {
    // GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 1 1)), SRID=4326
    expect(
      parse(
        '0107000020E6100000020000000101000000000000000000F03F000000000000004001020000000200000000000000000000000000000000000000000000000000F03F000000000000F03F'
      )
    ).toEqual({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [1, 2] },
        { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      ],
    });
  });

  it('handles big-endian encoding', () => {
    // POINT (1 2), SRID=4326, big-endian
    expect(parse('0020000001000010E63FF00000000000004000000000000000')).toEqual({
      type: 'Point',
      coordinates: [1, 2],
    });
  });

  it('decodes ISO WKB with no SRID (what DuckDB ST_AsHEXWKB emits)', () => {
    // POINT (5 6), ISO WKB
    expect(parse('010100000000000000000014400000000000001840')).toEqual({
      type: 'Point',
      coordinates: [5, 6],
    });
  });

  it('returns null for anything that is not WKB hex', () => {
    for (const value of ['{"type":"Point","coordinates":[1,2]}', 'POINT(1 2)', 'not hex', 'ABC', '', 'nope']) {
      expect(wkbToGeoJson(value)).toBeNull();
    }
  });
});
