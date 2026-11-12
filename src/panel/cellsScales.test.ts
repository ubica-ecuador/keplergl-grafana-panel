import { isSpacedScale, spacedScale, spacedThresholds } from './cellsScales';

describe('spaced colour scales', () => {
  it('spaces log classes evenly by ratio, rounded to two digits', () => {
    // 1 to 525 in six classes: each bound about 2.84 times the last.
    expect(spacedThresholds('log', 1, 525, 6)).toEqual([2.8, 8.1, 23, 65, 180]);
  });

  it('spaces square-root classes evenly on the root', () => {
    expect(spacedThresholds('sqrt', 0, 100, 5)).toEqual([4, 16, 36, 64]);
  });

  it('starts a log axis above zero', () => {
    const bounds = spacedThresholds('log', 0, 1000, 3);
    expect(bounds).toEqual([10, 100]);
  });

  it('gives no bounds for an empty or flat domain', () => {
    expect(spacedThresholds('log', 5, 5, 6)).toEqual([]);
    expect(spacedThresholds('sqrt', Number.NaN, 4, 6)).toEqual([]);
  });

  it('makes a threshold scale the legend can read', () => {
    const scale = spacedScale('log', [1, 525], ['a', 'b', 'c', 'd', 'e', 'f']);
    expect((scale as unknown as { scaleType: string }).scaleType).toBe('threshold');
    expect(scale(1)).toBe('a');
    expect(scale(10)).toBe('c');
    expect(scale(500)).toBe('f');
    expect(scale.invertExtent('c')).toEqual([8.1, 23]);
  });

  it('knows its scale names', () => {
    expect(isSpacedScale('log')).toBe(true);
    expect(isSpacedScale('quantile')).toBe(false);
  });
});
