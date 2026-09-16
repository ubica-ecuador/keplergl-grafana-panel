import { thinBySpacing } from './declutter';

describe('thinBySpacing', () => {
  const at = (x: number, y: number, weight: number) => ({ x, y, weight });
  const project = (row: { x: number; y: number }) => [row.x, row.y] as [number, number];
  const weightOf = (row: { weight: number }) => row.weight;

  it('keeps one symbol per screen cell, the biggest one', () => {
    const rows = [at(10, 10, 1), at(12, 12, 5), at(200, 200, 2)];

    const kept = thinBySpacing(rows, project, 50, weightOf);

    expect(kept).toHaveLength(2);
    expect(kept).toContainEqual(at(12, 12, 5));
    expect(kept).toContainEqual(at(200, 200, 2));
  });

  it('keeps everything when the spacing is smaller than the gaps', () => {
    const rows = [at(10, 10, 1), at(80, 80, 1)];

    expect(thinBySpacing(rows, project, 20, weightOf)).toHaveLength(2);
  });

  it('drops what the camera cannot place, rather than piling it at the origin', () => {
    const rows = [at(10, 10, 1), at(NaN, NaN, 9)];

    const kept = thinBySpacing(rows, (row) => (Number.isFinite(row.x) ? [row.x, row.y] : null), 50, weightOf);

    expect(kept).toEqual([at(10, 10, 1)]);
  });
});
