import { geoJsonToWkt } from './geoJsonToWkt';

/**
 * The inverse of wkbToGeoJson: a drawn kepler feature's GeoJSON geometry
 * becomes the canonical WKT that a dashboard variable carries into SQL
 * (`ST_GeomFromText($area, 4326)`). Canonical output — fixed micro-format,
 * plain numbers — is the SQL-injection story: the variable never carries text
 * the plugin did not format. Format pinned against shapely 2.1.2 `wkt` output.
 */
describe('geoJsonToWkt', () => {
  it('serializes a polygon with one ring', () => {
    expect(
      geoJsonToWkt({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      })
    ).toBe('POLYGON ((0 0, 0 1, 1 1, 1 0, 0 0))');
  });

  it('keeps interior rings', () => {
    expect(
      geoJsonToWkt({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 10],
            [10, 10],
            [10, 0],
            [0, 0],
          ],
          [
            [2, 2],
            [2, 3],
            [3, 3],
            [2, 2],
          ],
        ],
      })
    ).toBe('POLYGON ((0 0, 0 10, 10 10, 10 0, 0 0), (2 2, 2 3, 3 3, 2 2))');
  });

  it('serializes a multipolygon', () => {
    expect(
      geoJsonToWkt({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [0, 0],
            ],
          ],
          [
            [
              [2, 2],
              [2, 3],
              [3, 3],
              [2, 2],
            ],
          ],
        ],
      })
    ).toBe('MULTIPOLYGON (((0 0, 0 1, 1 1, 0 0)), ((2 2, 2 3, 3 3, 2 2)))');
  });

  it('closes a ring the editor left open', () => {
    // kepler always closes drawn rings, but a saved config may not.
    expect(
      geoJsonToWkt({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
          ],
        ],
      })
    ).toBe('POLYGON ((0 0, 0 1, 1 1, 0 0))');
  });

  it('rounds to 6 decimals with plain formatting', () => {
    // ~0.1 m of precision; keeps a hand-drawn polygon's URL footprint sane.
    expect(
      geoJsonToWkt({
        type: 'Polygon',
        coordinates: [
          [
            [-79.00000004, -2.900000049],
            [-78.123456789, -2.987654321],
            [-78.5, -2.1],
            [-79.00000004, -2.900000049],
          ],
        ],
      })
    ).toBe('POLYGON ((-79 -2.9, -78.123457 -2.987654, -78.5 -2.1, -79 -2.9))');
  });

  it('drops Z and M', () => {
    expect(
      geoJsonToWkt({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0, 5, 7],
            [0, 1, 5, 7],
            [1, 1, 5, 7],
            [0, 0, 5, 7],
          ],
        ],
      })
    ).toBe('POLYGON ((0 0, 0 1, 1 1, 0 0))');
  });

  it('returns null for anything that is not an areal geometry', () => {
    expect(geoJsonToWkt({ type: 'Point', coordinates: [1, 2] })).toBeNull();
    expect(
      geoJsonToWkt({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      })
    ).toBeNull();
    expect(geoJsonToWkt({ type: 'Polygon' })).toBeNull();
    expect(geoJsonToWkt({ type: 'Polygon', coordinates: 'nonsense' })).toBeNull();
    expect(geoJsonToWkt({ type: 'Polygon', coordinates: [] })).toBeNull();
  });

  it('rejects degenerate rings', () => {
    // Two positions close into three — no area to speak of.
    expect(
      geoJsonToWkt({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      })
    ).toBeNull();
  });

  it('rejects non-finite coordinates', () => {
    expect(
      geoJsonToWkt({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, NaN],
            [1, 1],
            [0, 0],
          ],
        ],
      })
    ).toBeNull();
  });
});
