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

  it('keeps a trip query tabular and attaches a trip layer', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'a', 'b', 'b'] },
        { name: 'latitude', type: FieldType.number, values: [1, 2, 3, 4] },
        { name: 'longitude', type: FieldType.number, values: [10, 20, 30, 40] },
        { name: 'time', type: FieldType.time, values: [1000, 2000, 1000, 2000] },
        { name: 'speed_kmh', type: FieldType.number, values: [4, 5, 6, 7] },
      ],
    });

    const [dataset] = framesToDatasets([frame]);

    // One row per GPS ping — collapsing them into one row per trip is what used
    // to strip every column but the geometry, leaving nothing to colour or
    // filter by. kepler groups the rows into paths itself.
    expect(dataset.rows).toHaveLength(4);
    expect(dataset.rows[0]).toEqual({ trip_id: 'a', latitude: 1, longitude: 10, time: 1000, speed_kmh: 4 });
    expect(dataset.tripLayer?.config.columnMode).toBe('table');
    expect(dataset.tripLayer?.config.dataId).toBe('grafana-A');
  });

  it('collapses a trip query into one row per trip in geojson mode', () => {
    // The compact shape: 10 rows instead of 100,000 when all that is wanted is
    // the animated path, and the shape every map configuration saved before the
    // table-column layer existed still points at.
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'a', 'b', 'b'] },
        { name: 'latitude', type: FieldType.number, values: [1, 2, 3, 4] },
        { name: 'longitude', type: FieldType.number, values: [10, 20, 30, 40] },
        { name: 'time', type: FieldType.time, values: [1000, 2000, 1000, 2000] },
      ],
    });

    const [dataset] = framesToDatasets([frame], {}, { tripLayerMode: 'geojson' });

    expect(dataset.rows.map((r) => r.trip_id)).toEqual(['a', 'b']);
    expect(JSON.parse(dataset.rows[0]._geojson as string).geometry.coordinates).toEqual([
      [10, 1, 0, 1000],
      [20, 2, 0, 2000],
    ]);
    // kepler builds the layer itself from a `_geojson` column, so the panel
    // supplies none.
    expect(dataset.tripLayer).toBeUndefined();
  });

  it('leaves a query without a trip id free of a trip layer', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'latitude', type: FieldType.number, values: [1] },
        { name: 'longitude', type: FieldType.number, values: [2] },
        { name: 'time', type: FieldType.time, values: [1000] },
      ],
    });

    expect(framesToDatasets([frame])[0].tripLayer).toBeUndefined();
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

  it('lets an override disable a detected role so a trip query loads as points', () => {
    // Trip rows replace the frame entirely, so a trajectory table cannot be
    // drawn as timestamped points — nor styled by any of its own columns —
    // unless the trip id can be switched off.
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'track_id', type: FieldType.string, values: ['a', 'a'] },
        { name: 'lat', type: FieldType.number, values: [1, 2] },
        { name: 'lng', type: FieldType.number, values: [10, 20] },
        { name: 'tracked_at', type: FieldType.time, values: [1000, 2000] },
        { name: 'speed_kmh', type: FieldType.number, values: [4.2, 5.1] },
      ],
    });

    const [dataset] = framesToDatasets([frame], { A: { tripId: null } });

    expect(dataset.rows).toHaveLength(2);
    expect(dataset.rows[0]).toEqual({
      track_id: 'a',
      latitude: 1,
      longitude: 10,
      time: 1000,
      speed_kmh: 4.2,
    });
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

    expect(dataset.rows[0].trip_id).toBe('a');
    expect(dataset.tripLayer?.config.columns.id).toBe('trip_id');
  });
});
