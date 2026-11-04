import { dayNightDatasets, NIGHT_COLOR, nightPolygon, nightShape, subsolarPoint } from './dayNight';

describe('the sun and the night', () => {
  it('puts the sun over the Tropic of Cancer at noon UTC of the June solstice', () => {
    const sun = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
    expect(sun.latitude).toBeCloseTo(23.4, 0);
    // The equation of time is under two minutes then: half a degree from Greenwich.
    expect(Math.abs(sun.longitude)).toBeLessThan(1);
  });

  it('puts it over the equator at the March equinox, and a quarter turn west six hours later', () => {
    expect(Math.abs(subsolarPoint(new Date('2026-03-20T12:00:00Z')).latitude)).toBeLessThan(0.5);
    expect(subsolarPoint(new Date('2026-03-20T18:00:00Z')).longitude).toBeCloseTo(-88, -1);
  });

  it('closes the night over the south pole in June, reaching the Arctic circle opposite the sun', () => {
    const [ring] = nightPolygon(new Date('2026-06-21T12:00:00Z')).coordinates;
    const opposite = ring.find(([lng]) => lng === 180)!;
    expect(opposite[1]).toBeCloseTo(66.6, 0);
    expect(ring.at(-2)).toEqual([-180, -85.0511]);
    expect(ring[0]).toEqual(ring.at(-1));
  });

  it('gives the panel a night layer and, when asked, the sun', () => {
    const at = new Date('2026-06-21T12:00:00Z');
    expect(dayNightDatasets(at, false, NIGHT_COLOR).map((d) => d.fixedLayer?.type)).toEqual(['geojson']);
    expect(dayNightDatasets(at, true, NIGHT_COLOR).map((d) => d.fixedLayer?.type)).toEqual(['geojson', 'point']);
  });

  it('repeats the night for the copies of the world beside the first', () => {
    const shape = nightShape(new Date('2026-06-21T12:00:00Z'));
    expect(shape.coordinates.map((polygon) => polygon[0][0][0])).toEqual([-540, -180, 180]);
  });
});
