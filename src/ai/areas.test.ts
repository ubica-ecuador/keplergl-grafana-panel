import { bboxPolygon, circlePolygon, contains, polygonFrom } from './areas';

describe('areas', () => {
  it('builds a closed circle whose radius holds in km at its latitude', () => {
    const circle = circlePolygon(-33.4, -70.6, 100);
    const ring = (circle.coordinates as number[][][])[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(contains(circle, -70.6, -33.4 + 0.85)).toBe(true); // ~94 km north
    expect(contains(circle, -70.6, -33.4 + 0.95)).toBe(false); // ~105 km north
    expect(contains(circle, -70.6 + 1.0, -33.4)).toBe(true); // ~93 km east at 33° S
    expect(contains(circle, -70.6 + 1.2, -33.4)).toBe(false); // ~112 km east
  });

  it('tests boxes, closes polygons and respects holes and multipolygons', () => {
    expect(contains(bboxPolygon(-80, -40, -60, -10), -70, -20)).toBe(true);
    expect(polygonFrom([[0, 0], [1, 0]])).toBeNull();
    const triangle = polygonFrom([[0, 0], [10, 0], [0, 10]])!;
    expect((triangle.coordinates as number[][][])[0]).toHaveLength(4);
    expect(contains(triangle, 2, 2)).toBe(true);
    expect(contains(triangle, 8, 8)).toBe(false);
    const donut = { type: 'Polygon', coordinates: [bboxPolygon(0, 0, 10, 10).coordinates[0], bboxPolygon(4, 4, 6, 6).coordinates[0]] };
    expect(contains(donut, 5, 5)).toBe(false);
    expect(contains(donut, 2, 2)).toBe(true);
    const multi = { type: 'MultiPolygon', coordinates: [bboxPolygon(0, 0, 1, 1).coordinates, bboxPolygon(5, 5, 6, 6).coordinates] };
    expect(contains(multi, 5.5, 5.5)).toBe(true);
  });
});
