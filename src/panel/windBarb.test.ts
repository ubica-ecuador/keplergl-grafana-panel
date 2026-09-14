import { barbIconKey, barbParts, toKnots } from './windBarb';

describe('toKnots', () => {
  it('converts every unit a query may give', () => {
    expect(toKnots(10, 'm/s')).toBeCloseTo(19.44, 2);
    expect(toKnots(36, 'km/h')).toBeCloseTo(19.44, 2);
    expect(toKnots(10, 'kn')).toBe(10);
    expect(toKnots(10, 'ft/s')).toBeCloseTo(5.92, 2);
    expect(toKnots(10, 'mph')).toBeCloseTo(8.69, 2);
  });
});

describe('barbParts', () => {
  it.each([
    [0, 'calm'],
    [2, 'calm'],
    [3, 5],
    [7, 5],
    [8, 10],
    [12, 10],
    [48, 50],
    [50, 50],
    [52, 50],
    [65, 65],
    [203, 200],
  ])('draws %s knots as %s', (knots, expected) => {
    const parts = barbParts(knots as number);

    if (expected === 'calm') {
      expect(parts.calm).toBe(true);
    } else {
      expect(parts.calm).toBe(false);
      expect(parts.knots).toBe(expected);
    }
  });

  it('builds a speed from pennants of fifty, barbs of ten and a half barb of five', () => {
    expect(barbParts(65)).toEqual({ knots: 65, calm: false, pennants: 1, full: 1, half: true });
    expect(barbParts(45)).toEqual({ knots: 45, calm: false, pennants: 0, full: 4, half: true });
    expect(barbParts(150)).toEqual({ knots: 150, calm: false, pennants: 3, full: 0, half: false });
  });
});

describe('barbIconKey', () => {
  it('names a barb by its speed and its hemisphere, and calm by itself', () => {
    expect(barbIconKey(barbParts(15), false)).toBe('barb-15-n');
    expect(barbIconKey(barbParts(15), true)).toBe('barb-15-s');
    // Calm has no side to draw its barbs on.
    expect(barbIconKey(barbParts(1), true)).toBe('calm');
  });
});
