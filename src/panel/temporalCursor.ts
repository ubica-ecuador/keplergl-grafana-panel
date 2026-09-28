import { parseGeoJsonRawFeature, parseTripGeoJsonTimestamp } from '@kepler.gl/layers';
import { timeToUnixMilli } from '@kepler.gl/utils';
import type { VisStateLike } from './selectionHaloInput';
import { trajectoryTimeIndex, type TrajectoryTimeIndex, type TrajectorySample } from './trajectoryTimeIndex';

type Layer = NonNullable<VisStateLike['layers']>[number];
type Dataset = NonNullable<VisStateLike['datasets']>[string];

const cache = new WeakMap<
  object,
  Map<string, { revision: unknown; count: number; signature: string; index: TrajectoryTimeIndex }>
>();
const EMPTY: TrajectoryTimeIndex = [];
const number = (value: unknown) => (value === null || value === undefined || value === '' ? NaN : Number(value));

/** Cached on the actual rows, revision and column mapping, independent of hover and filters. */
export function cursorIndex(layer: Layer, dataset: Dataset): TrajectoryTimeIndex {
  if (layer.type !== 'trip' && layer.type !== 'point') {
    return EMPTY;
  }
  const { columns = {}, columnMode } = layer.config;
  const col = (role: string) => columns[role]?.fieldIdx ?? -1;
  const geo = layer.type === 'trip' && columnMode === 'geojson';
  if (layer.type === 'point' && columnMode && columnMode !== 'points') {
    return EMPTY;
  }
  const timeCol = layer.type === 'trip' ? col('timestamp') : dataset.fields.findIndex((f) => f.name === 'time');
  const idCol = layer.type === 'trip' ? col('id') : dataset.fields.findIndex((f) => f.name === 'trip_id');
  if (geo ? col('geojson') < 0 : timeCol < 0 || col('lat') < 0 || col('lng') < 0) {
    return EMPTY;
  }
  const container = dataset.dataContainer;
  const key = JSON.stringify([geo, columns, timeCol, idCol, dataset.fields]);
  let entries = cache.get(container);
  if (!entries) {
    entries = new Map();
    cache.set(container, entries);
  }
  const count = container.numRows();
  const previous = entries.get(layer.id);
  if (
    previous &&
    previous.revision === dataset.dataRevision &&
    previous.count === count &&
    previous.signature === key
  ) {
    return previous.index;
  }
  const groups = new Map<unknown, TrajectorySample[]>();
  if (geo) {
    for (let row = 0; row < count; row++) {
      const feature = parseGeoJsonRawFeature(container.valueAt(row, col('geojson')));
      if (feature?.geometry?.type !== 'LineString') {
        continue;
      }
      const times = parseTripGeoJsonTimestamp([feature]).dataToTimeStamp[0];
      const samples = feature.geometry.coordinates.map((coord, i) => ({
        time: times?.[i] ?? NaN,
        position: [number(coord[0]), number(coord[1]), number(coord[2] ?? 0)] as [number, number, number],
        row,
      }));
      groups.set(row, samples);
    }
  } else {
    const field = dataset.fields[timeCol];
    for (let row = 0; row < count; row++) {
      const value = container.valueAt(row, timeCol);
      const time =
        value == null || value === ''
          ? NaN
          : field.format
            ? (timeToUnixMilli(value as string | number, field.format) ?? NaN)
            : number(value);
      const id = idCol >= 0 ? container.valueAt(row, idCol) : 'single-track';
      if (id == null) {
        continue;
      }
      const samples = groups.get(id) ?? [];
      samples.push({
        time,
        row,
        position: [
          number(container.valueAt(row, col('lng'))),
          number(container.valueAt(row, col('lat'))),
          col('altitude') >= 0 ? number(container.valueAt(row, col('altitude'))) : 0,
        ],
      });
      groups.set(id, samples);
    }
  }
  const index = trajectoryTimeIndex(groups.values());
  // A mapping edit replaces the cached index, rather than retaining old copies of every GPS point.
  entries.set(layer.id, { revision: dataset.dataRevision, count, signature: key, index });
  return index;
}
