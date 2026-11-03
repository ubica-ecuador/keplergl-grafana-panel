import { FieldType, toDataFrame } from '@grafana/data';

import { buildRouteSegments } from './buildRoute';
import { framesToDatasets } from './framesToDatasets';

const track = toDataFrame({
  refId: 'A',
  fields: [
    { name: 'time', type: FieldType.time, values: [1, 2, 3, 4] },
    { name: 'lat', type: FieldType.number, values: [0, 1, null, 3] },
    { name: 'lon', type: FieldType.number, values: [10, 11, 12, 13] },
    { name: 'speed', type: FieldType.number, values: [5, 6, 7, 8] },
  ],
});

describe('buildRouteSegments', () => {
  it('joins each row to the next and keeps the starting row’s columns', () => {
    const segments = buildRouteSegments([
      { latitude: 0, longitude: 10, speed: 5 },
      { latitude: 1, longitude: 11, speed: 6 },
      { latitude: 2, longitude: 12, speed: 7 },
    ]);

    expect(segments).toEqual([
      { latitude: 0, longitude: 10, speed: 5, lat0: 0, lng0: 10, lat1: 1, lng1: 11 },
      { latitude: 1, longitude: 11, speed: 6, lat0: 1, lng0: 11, lat1: 2, lng1: 12 },
    ]);
  });

  it('leaves out a segment with an end missing its position', () => {
    const segments = buildRouteSegments([
      { latitude: 0, longitude: 10 },
      { latitude: null, longitude: 11 },
      { latitude: 2, longitude: 12 },
    ]);
    expect(segments).toEqual([]);
  });
});

describe('framesToDatasets with routes', () => {
  it('adds a route dataset beside the query’s own, only for the queries named', () => {
    const datasets = framesToDatasets([track], {}, { routeQueries: ['A'] });

    expect(datasets.map((d) => d.id)).toEqual(['grafana-A', 'grafana-A-route']);
    expect(datasets[0].rows).toHaveLength(4);
    expect(datasets[1].routeLayer).toMatchObject({
      type: 'line',
      config: { dataId: 'grafana-A-route', columns: { lat0: 'lat0', lng0: 'lng0', lat1: 'lat1', lng1: 'lng1' } },
    });
    // The row with no latitude breaks both segments it would end or start.
    expect(datasets[1].rows.map((r) => r.speed)).toEqual([5]);
    expect(framesToDatasets([track], {}, { routeQueries: ['B'] }).map((d) => d.id)).toEqual(['grafana-A']);
  });

  it('gives an empty route its columns, so a saved line layer still finds them', () => {
    const empty = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'lat', type: FieldType.number, values: [] },
        { name: 'lon', type: FieldType.number, values: [] },
      ],
    });
    const [, route] = framesToDatasets([empty], {}, { routeQueries: ['A'] });

    expect(route.columns?.map((c) => c.name)).toEqual(['latitude', 'longitude', 'lat0', 'lng0', 'lat1', 'lng1']);
  });
});
