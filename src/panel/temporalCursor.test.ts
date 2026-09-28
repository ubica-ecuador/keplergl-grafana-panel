import { cursorIndex } from './temporalCursor';
import { positionsAtTime } from './trajectoryTimeIndex';
import type { VisStateLike } from './selectionHaloInput';

const start = 1753257600000;
const layer = {
  id: 'trip',
  type: 'trip',
  config: {
    dataId: 'A',
    isVisible: true,
    columnMode: 'table',
    columns: { timestamp: { fieldIdx: 0 }, lat: { fieldIdx: 1 }, lng: { fieldIdx: 2 }, id: { fieldIdx: 3 } },
  },
};
function dataset(rows: unknown[][]) {
  return {
    fields: ['time', 'latitude', 'longitude', 'trip_id'].map((name) => ({ name })),
    dataContainer: { numRows: () => rows.length, valueAt: jest.fn((r: number, c: number) => rows[r][c]) },
    dataRevision: 0,
  };
}

it('groups table trips and points, excludes missing positions, caches and refreshes', () => {
  const data = dataset([
    [start, -2, -79, 'a'],
    [start + 1000, -3, -78, 'a'],
    [start, null, -70, 'b'],
  ]);
  const index = cursorIndex(layer, data);
  expect(index).toHaveLength(1);
  const reads = data.dataContainer.valueAt.mock.calls.length;
  expect(cursorIndex(layer, { ...data })).toBe(index);
  expect(data.dataContainer.valueAt).toHaveBeenCalledTimes(reads);
  expect(cursorIndex(layer, { ...data, dataRevision: 1 })).not.toBe(index);
  expect(cursorIndex({ ...layer, type: 'point', config: { ...layer.config, columnMode: 'points' } }, data)).toEqual(
    index
  );
});

it('does not let differently mapped layers evict each other’s index', () => {
  const data = dataset([[start, -2, -79, 'a']]);
  const a = cursorIndex(layer, data);
  cursorIndex({ ...layer, id: 'other' }, data);
  expect(cursorIndex(layer, data)).toBe(a);
});

it('reads timestamped GeoJSON using kepler’s timestamp units', () => {
  const feature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [-79, -2, 0, start],
        [-78, -3, 0, start + 1000],
      ],
    },
  };
  const data = dataset([[JSON.stringify(feature)]]);
  const geo = { ...layer, config: { ...layer.config, columnMode: 'geojson', columns: { geojson: { fieldIdx: 0 } } } };
  expect(positionsAtTime(cursorIndex(geo, data), start + 500, 1000)[0].position).toEqual([-79, -2, 0]);
});

it('ignores unsupported layers and invalid column mappings', () => {
  const data = dataset([[start, -2, -79, 'a']]);
  expect(cursorIndex({ ...layer, type: 'heatmap' }, data)).toEqual([]);
  expect(cursorIndex({ ...layer, config: { ...layer.config, columns: {} } }, data)).toEqual([]);
});

it('converts seconds when kepler declares the x timestamp format', () => {
  const data: NonNullable<VisStateLike['datasets']>[string] = dataset([[start / 1000, -2, -79, 'a']]);
  data.fields[0] = { name: 'time', format: 'x' };
  expect(cursorIndex(layer, data)[0][0].time).toBe(start);
});
