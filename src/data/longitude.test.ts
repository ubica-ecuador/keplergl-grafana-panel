import { nearestCopy, wrapLongitude } from './longitude';

describe('wrapLongitude', () => {
  it('leaves a longitude within ±180° as it is, the antimeridian included', () => {
    expect(wrapLongitude(0)).toBe(0);
    expect(wrapLongitude(-78.5)).toBe(-78.5);
    expect(wrapLongitude(180)).toBe(180);
    expect(wrapLongitude(-180)).toBe(-180);
  });

  it('brings a longitude on another copy of the world back within ±180°', () => {
    expect(wrapLongitude(190)).toBeCloseTo(-170);
    expect(wrapLongitude(-190)).toBeCloseTo(170);
    expect(wrapLongitude(370)).toBeCloseTo(10);
    expect(wrapLongitude(-538.44)).toBeCloseTo(-178.44);
    expect(wrapLongitude(540)).toBeCloseTo(-180);
  });

  it('passes what is not a number through', () => {
    expect(wrapLongitude(Number.NaN)).toBeNaN();
    expect(wrapLongitude(Infinity)).toBe(Infinity);
  });
});

describe('nearestCopy', () => {
  it('moves a place across the antimeridian to the side the view is on', () => {
    // Suva, seen from a centre deck has wrapped to -176°: 4° west of it, not 354° east.
    expect(nearestCopy(178.44, -176)).toBeCloseTo(-181.56);
    // Nuku'alofa, seen from 178°: 7° east.
    expect(nearestCopy(-175.2, 178)).toBeCloseTo(184.8);
  });

  it('leaves a place on the view side as it is', () => {
    expect(nearestCopy(-78.5, -60)).toBe(-78.5);
    expect(nearestCopy(178.44, 178)).toBe(178.44);
  });

  it('finds the copy from a centre several worlds away', () => {
    expect(nearestCopy(10, 725)).toBeCloseTo(730);
    expect(nearestCopy(730, 0)).toBeCloseTo(10);
  });

  it('passes what is not a number through', () => {
    expect(nearestCopy(Number.NaN, 0)).toBeNaN();
    expect(nearestCopy(10, Number.NaN)).toBe(10);
  });
});
