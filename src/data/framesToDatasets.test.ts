import { FieldType, toDataFrame } from '@grafana/data';

import { framesToDatasets } from './framesToDatasets';

describe('framesToDatasets', () => {
  it('turns a plain point query into one tabular dataset per query', () => {
    const frame = toDataFrame({
      refId: 'A',
      name: 'gps',
      fields: [
        { name: 'latitude', type: FieldType.number, values: [-2.9, -2.8] },
        { name: 'longitude', type: FieldType.number, values: [-79.0, -78.9] },
      ],
    });

    const [dataset] = framesToDatasets([frame]);

    expect(dataset.id).toBe('grafana-A');
    expect(dataset.label).toBe('gps');
    expect(dataset.rows).toHaveLength(2);
    expect(dataset.rows[0]).toEqual({ latitude: -2.9, longitude: -79.0 });
  });

  it('collapses a trip query (trip id + time + lat/lng) into one row per trip', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'a', 'b', 'b'] },
        { name: 'latitude', type: FieldType.number, values: [1, 2, 3, 4] },
        { name: 'longitude', type: FieldType.number, values: [10, 20, 30, 40] },
        { name: 'time', type: FieldType.time, values: [1000, 2000, 1000, 2000] },
      ],
    });

    const [dataset] = framesToDatasets([frame]);

    // One row per trip, not one per GPS ping.
    expect(dataset.rows.map((r) => r.trip_id)).toEqual(['a', 'b']);
    const first = JSON.parse(dataset.rows[0]._geojson as string);
    expect(first.geometry.type).toBe('LineString');
    expect(first.geometry.coordinates).toEqual([
      [10, 1, 0, 1000],
      [20, 2, 0, 2000],
    ]);
  });

  it('attaches a flow layer to an origin-destination query', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'origin_lat', type: FieldType.number, values: [1] },
        { name: 'origin_lon', type: FieldType.number, values: [2] },
        { name: 'dest_lat', type: FieldType.number, values: [3] },
        { name: 'dest_lon', type: FieldType.number, values: [4] },
        { name: 'trips', type: FieldType.number, values: [42] },
      ],
    });

    const [dataset] = framesToDatasets([frame], {}, { flowRenderMode: 'curved' });

    // Rows carry the flow column names, and a flow layer rides along.
    expect(dataset.rows[0]).toEqual({ lat0: 1, lng0: 2, lat1: 3, lng1: 4, count: 42 });
    expect(dataset.flowLayer?.type).toBe('flow');
    expect(dataset.flowLayer?.config.dataId).toBe('grafana-A');
    expect(dataset.flowLayer?.config.visConfig.flowLinesRenderingMode).toBe('curved');
  });

  it('leaves a plain point query without a flow layer', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'latitude', type: FieldType.number, values: [1] },
        { name: 'longitude', type: FieldType.number, values: [2] },
      ],
    });

    expect(framesToDatasets([frame])[0].flowLayer).toBeUndefined();
  });

  it('lets an override turn a query into trips even when names are unrecognised', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'car', type: FieldType.string, values: ['a', 'a'] },
        { name: 'y', type: FieldType.number, values: [1, 2] },
        { name: 'x', type: FieldType.number, values: [10, 20] },
        { name: 'ts', type: FieldType.time, values: [1000, 2000] },
      ],
    });

    const [dataset] = framesToDatasets([frame], {
      A: { tripId: 'car', latitude: 'y', longitude: 'x', time: 'ts' },
    });

    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0].trip_id).toBe('a');
  });
});
