import { backToFront, needsResort } from './splatOrder';

describe('the order splats are drawn in', () => {
  it('puts the farthest from the eye first', () => {
    const positions = new Float32Array([0, 0, 5, 0, 0, 1, 0, 0, 10, 0, 0, 3]);
    expect(Array.from(backToFront(positions, 4, [0, 0, 0]))).toEqual([2, 0, 3, 1]);
    // Seen from the other end, the other way round.
    expect(Array.from(backToFront(positions, 4, [0, 0, 20]))).toEqual([1, 3, 0, 2]);
  });

  it('fills the array it is given, and copes with one splat or all at one distance', () => {
    const out = new Float32Array(3);
    expect(backToFront(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3, [0, 0, 0], out)).toBe(out);
    expect(Array.from(out).sort()).toEqual([0, 1, 2]);
    expect(Array.from(backToFront(new Float32Array([4, 5, 6]), 1, [0, 0, 0]))).toEqual([0]);
  });

  it('is sorted again only once the eye has moved by a share of its distance', () => {
    const centre = [0, 0, 0];
    expect(needsResort(null, [100, 0, 0], centre)).toBe(true);
    expect(needsResort([100, 0, 0], [100.5, 0, 0], centre)).toBe(false);
    expect(needsResort([100, 0, 0], [102, 0, 0], centre)).toBe(true);
  });
});
