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

describe('framesToDatasets — velocity grids', () => {
  /** A 4×4 grid at 1° spacing carrying a steady eastward wind. */
  const windFrame = () => {
    const lat: number[] = [];
    const lon: number[] = [];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        lat.push(j);
        lon.push(i);
      }
    }
    return toDataFrame({
      refId: 'A',
      fields: [
        { name: 'lat', type: FieldType.number, values: lat },
        { name: 'lon', type: FieldType.number, values: lon },
        { name: 'u', type: FieldType.number, values: lat.map(() => 12) },
        { name: 'v', type: FieldType.number, values: lat.map(() => 0) },
      ],
    });
  };

  it('hands kepler the grid itself and adds a flow field layer over it', () => {
    // The rows are the samples the query returned, not the lines drawn from
    // them: what gets painted exists nowhere in the data, and is traced by the
    // layer at draw time, from the viewport.
    const [dataset] = framesToDatasets([windFrame()]);

    expect(dataset.rows).toHaveLength(16);
    expect(dataset.rows[0]).toEqual({ latitude: 0, longitude: 0, u: 12, v: 0 });

    expect(dataset.flowFieldLayer?.type).toBe('flowfield');
    expect(dataset.flowFieldLayer?.config.columnMode).toBe('components');
    // kepler guesses a Point layer from the same coordinates; nothing else.
    expect(dataset.tripLayer).toBeUndefined();
    expect(dataset.flowLayer).toBeUndefined();
  });

  it('leaves a trajectory that happens to carry speed alone', () => {
    // A GPS trace with a `speed` column is not a velocity field. Without the
    // trip id guard it would be shredded into streamlines that mean nothing.
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'trip_id', type: FieldType.string, values: ['a', 'a'] },
        { name: 'lat', type: FieldType.number, values: [0, 1] },
        { name: 'lon', type: FieldType.number, values: [0, 1] },
        { name: 'time', type: FieldType.time, values: [1000, 2000] },
        { name: 'speed', type: FieldType.number, values: [3, 4] },
        { name: 'wind_direction', type: FieldType.number, values: [90, 90] },
      ],
    });

    const [dataset] = framesToDatasets([frame], {}, {});

    expect(dataset.rows).toHaveLength(2);
    expect(dataset.flowFieldLayer).toBeUndefined();
    expect(dataset.tripLayer).toBeDefined();
  });
});

describe('framesToDatasets — a velocity grid with several timesteps', () => {
  /** Two hours of a reversing wind over the same 4×4 grid. */
  const forecast = () => {
    const lat: number[] = [];
    const lon: number[] = [];
    const time: number[] = [];
    const u: number[] = [];

    for (const [t, speed] of [
      [1_000, 12],
      [2_000, -12],
    ] as Array<[number, number]>) {
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          lat.push(j);
          lon.push(i);
          time.push(t);
          u.push(speed);
        }
      }
    }

    return toDataFrame({
      refId: 'A',
      fields: [
        { name: 'lat', type: FieldType.number, values: lat },
        { name: 'lon', type: FieldType.number, values: lon },
        { name: 'time', type: FieldType.time, values: time },
        { name: 'u', type: FieldType.number, values: u },
        { name: 'v', type: FieldType.number, values: u.map(() => 0) },
      ],
    });
  };

  it('keeps the earliest hour instead of mixing them', () => {
    // Left alone, each cell would be overwritten by whichever row came last,
    // which for a reversing wind means drawing the opposite of the truth.
    const [dataset] = framesToDatasets([forecast()]);

    expect(dataset.rows).toHaveLength(16);
    expect(dataset.rows.every((row) => row.u === 12)).toBe(true);
  });

  it('drops the time column with the hours it belonged to', () => {
    // A grid reaching kepler with a timestamp grows a time filter over rows
    // nobody filters — the layer reads the whole dataset — leaving a widget on
    // the map that moves and changes nothing.
    const [dataset] = framesToDatasets([forecast()]);

    expect(dataset.rows[0].time).toBeUndefined();
    expect(Object.keys(dataset.rows[0])).toEqual(['latitude', 'longitude', 'u', 'v']);
  });
});

describe('framesToDatasets — velocity grid columns', () => {
  const polarFrame = () =>
    toDataFrame({
      refId: 'A',
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 1] },
        { name: 'lon', type: FieldType.number, values: [0, 1] },
        { name: 'wind_speed_10m', type: FieldType.number, values: [4, 5] },
        { name: 'wind_direction_10m', type: FieldType.number, values: [90, 90] },
        { name: 'alt', type: FieldType.number, values: [850, 850] },
      ],
    });

  it('points the layer at the speed/direction columns the query used', () => {
    const [dataset] = framesToDatasets([polarFrame()]);

    expect(dataset.flowFieldLayer?.config.columnMode).toBe('polar');
    expect(dataset.flowFieldLayer?.config.columns).toEqual({
      lat: 'latitude',
      lng: 'longitude',
      speed: 'wind_speed_10m',
      direction: 'wind_direction_10m',
    });
  });

  it('binds the altitude column when the mapping names one', () => {
    // Height stays opt-in: an `elevation` column mapped by accident lifts a
    // level kilometres into the air, where it vanishes as the camera descends.
    const [dataset] = framesToDatasets([polarFrame()], { A: { altitude: 'alt' } });

    expect(dataset.flowFieldLayer?.config.columns.altitude).toBe('altitude');
    expect(dataset.rows[0].altitude).toBe(850);
  });
});
