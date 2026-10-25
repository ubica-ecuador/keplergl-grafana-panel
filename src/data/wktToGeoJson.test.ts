import { geoJsonToWkt } from './geoJsonToWkt';
import { wktToGeoJson } from './wktToGeoJson';

describe('wktToGeoJson', () => {
  it('reads back what geoJsonToWkt writes', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-170.5, -20],
          [-150, -20],
          [-160, 5.25],
          [-170.5, -20],
        ],
      ],
    };
    const wkt = geoJsonToWkt(geometry)!;
    expect(wktToGeoJson(wkt)).toEqual(geometry);
  });

  it('reads a multipolygon with a hole', () => {
    const wkt = 'MULTIPOLYGON (((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1)), ((10 10, 11 10, 11 11, 10 10)))';
    const geometry = wktToGeoJson(wkt);
    expect(geometry?.type).toBe('MultiPolygon');
    expect(geometry?.coordinates).toHaveLength(2);
    expect(geoJsonToWkt(geometry!)).toBe(wkt);
  });

  it('takes any case and spacing, an SRID prefix and Z ordinates', () => {
    expect(wktToGeoJson('SRID=4326;polygon Z((0 0 1,1 0 1,1 1 1,0 0 1))')).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
  });

  it('closes an open ring', () => {
    expect(wktToGeoJson('POLYGON ((0 0, 1 0, 1 1))')?.coordinates[0]).toHaveLength(4);
  });

  it.each([
    '',
    'POINT (1 2)',
    'POLYGON EMPTY',
    'POLYGON ((0 0, 1 0, 0 0))',
    'POLYGON ((0 0, 1 0, 1 x, 0 0))',
    'POLYGON ((0 0, 1 0, 1 1, 0 0)',
    'POLYGON ((0 0, 1 0, 1 1, 0 0))) ((1 1',
    'POLYGON ((0 0, 1 0, 1 1, 0 0)) junk',
  ])('is null for %p', (wkt) => {
    expect(wktToGeoJson(wkt)).toBeNull();
  });
});
