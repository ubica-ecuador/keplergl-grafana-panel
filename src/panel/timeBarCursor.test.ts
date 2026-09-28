import { timeAtX, xAtTime } from './timeBarCursor';

// A 200 px track starting 6 px into its container, over 1000 ms.
const bar = { left: 6, width: 200, range: [1000, 2000] as const };

it('maps the track ends and middle both ways', () => {
  expect(timeAtX(6, bar)).toBe(1000);
  expect(timeAtX(106, bar)).toBe(1500);
  expect(timeAtX(206, bar)).toBe(2000);
  expect(xAtTime(1000, bar)).toBe(6);
  expect(xAtTime(1250, bar)).toBe(56);
  expect(xAtTime(2000, bar)).toBe(206);
});

it('reads nothing off the track or outside the range', () => {
  expect(timeAtX(3, bar)).toBeNull();
  expect(timeAtX(209, bar)).toBeNull();
  expect(xAtTime(999, bar)).toBeNull();
  expect(xAtTime(2001, bar)).toBeNull();
});

it('refuses a collapsed track, an empty range and non-numbers', () => {
  expect(timeAtX(6, { ...bar, width: 0 })).toBeNull();
  expect(xAtTime(1000, { ...bar, range: [1000, 1000] })).toBeNull();
  expect(timeAtX(NaN, bar)).toBeNull();
  expect(xAtTime(NaN, bar)).toBeNull();
});
