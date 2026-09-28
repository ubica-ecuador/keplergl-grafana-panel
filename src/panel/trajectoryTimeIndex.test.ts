import { positionsAtTime, trajectoryTimeIndex, type TrajectorySample } from './trajectoryTimeIndex';

const sample = (time: number, row = time): TrajectorySample => ({ time, row, position: [-79, -2, 0] });

it('sorts each trip, chooses the last duplicate and never crosses a trip boundary', () => {
  const index = trajectoryTimeIndex([
    [sample(30), sample(10), sample(20, 1), sample(20, 2)],
    [sample(15), sample(25)],
  ]);
  expect(positionsAtTime(index, 20, 10).map((s) => s.row)).toEqual([2, 15]);
  expect(positionsAtTime(index, 29, 10).map((s) => s.row)).toEqual([2]);
  expect(positionsAtTime(index, 31, 100)).toEqual([]);
  expect(positionsAtTime(index, 9, 100)).toEqual([]);
});

it('hides stale samples and accepts an exact timestamp with zero tolerance', () => {
  const index = trajectoryTimeIndex([[sample(0), sample(100)]]);
  expect(positionsAtTime(index, 50, 10)).toEqual([]);
  expect(positionsAtTime(index, 0, 0)).toEqual([sample(0)]);
  expect(positionsAtTime(index, 100, 0)).toEqual([sample(100)]);
  expect(positionsAtTime(index, NaN, 100)).toEqual([]);
});

it('rejects invalid coordinates and timestamps', () => {
  const index = trajectoryTimeIndex([[sample(NaN), { ...sample(1), position: [181, 0, 0] }, sample(2)]]);
  expect(index).toEqual([[sample(2)]]);
});

it.each([10000, 100000])('queries %i samples with logarithmic reads', (count) => {
  const samples = Array.from({ length: count }, (_, i) => sample(i));
  let reads = 0;
  const observed = new Proxy(samples, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        reads++;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  expect(positionsAtTime([observed], count / 2, 1)[0].time).toBe(count / 2);
  expect(reads).toBeLessThan(25);
});
