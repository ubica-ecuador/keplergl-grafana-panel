import { mapHoverTime } from './mapHoverTime';
import type { VisStateLike } from './selectionHaloInput';

const visState: VisStateLike = {
  layers: [{ id: 'points', type: 'point', config: { dataId: 'A', isVisible: true, columnMode: 'points' } }],
  datasets: {
    A: {
      fields: [{ name: 'time' }],
      dataContainer: {
        numRows: () => 2,
        valueAt: (row) => [100, 200][row],
      },
    },
  },
};
const pick = { picked: true, object: { index: 1 }, index: 0, layer: { props: { idx: 0 } }, mapIndex: 0 };
const passes = () => true;
it('reads the original row index, not the filtered picking index', () => {
  expect(mapHoverTime(visState, pick, 0, undefined, passes)).toBe(200);
  expect(mapHoverTime(visState, { ...pick, object: null }, 0, undefined, passes)).toBe(100);
});
it('ignores other map sides, hidden/unsupported layers, filters and empty picks', () => {
  expect(mapHoverTime(visState, pick, 1, undefined, passes)).toBeNull();
  expect(mapHoverTime(visState, pick, 0, 'other', passes)).toBeNull();
  expect(mapHoverTime(visState, pick, 0, undefined, () => false)).toBeNull();
  expect(mapHoverTime(visState, null, 0, undefined, passes)).toBeNull();
  expect(mapHoverTime(visState, { ...pick, picked: false }, 0, undefined, passes)).toBeNull();
  expect(
    mapHoverTime({ ...visState, layers: [{ ...visState.layers![0], type: 'trip' }] }, pick, 0, undefined, passes)
  ).toBeNull();
  expect(mapHoverTime({ ...visState, splitMaps: [{ layers: {} }] }, pick, 0, undefined, passes)).toBeNull();
});
