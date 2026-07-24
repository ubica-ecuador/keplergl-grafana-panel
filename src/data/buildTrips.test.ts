import { FieldType, toDataFrame } from '@grafana/data';

import { buildTrips } from './buildTrips';

/** Parse the `_geojson` column of a produced row back into an object. */
const geojson = (row: Record<string, unknown>) => JSON.parse(row._geojson as string);

describe('buildTrips', () => {
  it('groups a trip into a LineString of [lng, lat, alt, ts] coordinates', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'a'] },
        { name: 'latitude', type: FieldType.number, values: [-2.9, -2.8] },
        { name: 'longitude', type: FieldType.number, values: [-79.0, -78.9] },
        { name: 'time', type: FieldType.time, values: [1000, 2000] },
      ],
    });

    const rows = buildTrips(frame, {
      tripId: 'trip_id',
      latitude: 'latitude',
      longitude: 'longitude',
      time: 'time',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].trip_id).toBe('a');
    expect(geojson(rows[0])).toEqual({
      type: 'Feature',
      properties: { trip_id: 'a' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-79.0, -2.9, 0, 1000],
          [-78.9, -2.8, 0, 2000],
        ],
      },
    });
  });

  it('sorts each trip by time even when the query returns rows out of order', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'a', 'a'] },
        { name: 'latitude', type: FieldType.number, values: [1, 2, 3] },
        { name: 'longitude', type: FieldType.number, values: [10, 20, 30] },
        { name: 'time', type: FieldType.time, values: [3000, 1000, 2000] },
      ],
    });

    const rows = buildTrips(frame, {
      tripId: 'trip_id',
      latitude: 'latitude',
      longitude: 'longitude',
      time: 'time',
    });

    expect(geojson(rows[0]).geometry.coordinates).toEqual([
      [20, 2, 0, 1000],
      [30, 3, 0, 2000],
      [10, 1, 0, 3000],
    ]);
  });

  it('emits one feature per trip id, preserving first-seen order', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'b', 'a', 'b'] },
        { name: 'latitude', type: FieldType.number, values: [1, 5, 2, 6] },
        { name: 'longitude', type: FieldType.number, values: [1, 5, 2, 6] },
        { name: 'time', type: FieldType.time, values: [1000, 1000, 2000, 2000] },
      ],
    });

    const rows = buildTrips(frame, {
      tripId: 'trip_id',
      latitude: 'latitude',
      longitude: 'longitude',
      time: 'time',
    });

    expect(rows.map((r) => r.trip_id)).toEqual(['a', 'b']);
    expect(geojson(rows[0]).geometry.coordinates).toHaveLength(2);
    expect(geojson(rows[1]).geometry.coordinates).toHaveLength(2);
  });

  it('drops a trip with fewer than two points — a line needs two', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'b', 'b'] },
        { name: 'latitude', type: FieldType.number, values: [1, 5, 6] },
        { name: 'longitude', type: FieldType.number, values: [1, 5, 6] },
        { name: 'time', type: FieldType.time, values: [1000, 1000, 2000] },
      ],
    });

    const rows = buildTrips(frame, {
      tripId: 'trip_id',
      latitude: 'latitude',
      longitude: 'longitude',
      time: 'time',
    });

    expect(rows.map((r) => r.trip_id)).toEqual(['b']);
  });

  it('uses the altitude column when the role is mapped', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'a'] },
        { name: 'latitude', type: FieldType.number, values: [1, 2] },
        { name: 'longitude', type: FieldType.number, values: [10, 20] },
        { name: 'time', type: FieldType.time, values: [1000, 2000] },
        { name: 'alt', type: FieldType.number, values: [100, 200] },
      ],
    });

    const rows = buildTrips(frame, {
      tripId: 'trip_id',
      latitude: 'latitude',
      longitude: 'longitude',
      time: 'time',
      altitude: 'alt',
    });

    expect(geojson(rows[0]).geometry.coordinates).toEqual([
      [10, 1, 100, 1000],
      [20, 2, 200, 2000],
    ]);
  });

  it('skips points missing a coordinate or a timestamp', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'a', 'a'] },
        { name: 'latitude', type: FieldType.number, values: [1, null, 3] },
        { name: 'longitude', type: FieldType.number, values: [10, 20, 30] },
        { name: 'time', type: FieldType.time, values: [1000, 2000, 3000] },
      ],
    });

    const rows = buildTrips(frame, {
      tripId: 'trip_id',
      latitude: 'latitude',
      longitude: 'longitude',
      time: 'time',
    });

    expect(geojson(rows[0]).geometry.coordinates).toEqual([
      [10, 1, 0, 1000],
      [30, 3, 0, 3000],
    ]);
  });

  it('returns no trips for an empty frame', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'trip_id', type: FieldType.string, values: [] },
        { name: 'latitude', type: FieldType.number, values: [] },
        { name: 'longitude', type: FieldType.number, values: [] },
        { name: 'time', type: FieldType.time, values: [] },
      ],
    });

    expect(
      buildTrips(frame, {
        tripId: 'trip_id',
        latitude: 'latitude',
        longitude: 'longitude',
        time: 'time',
      })
    ).toEqual([]);
  });
});
