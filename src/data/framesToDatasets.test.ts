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

describe('framesToDatasets — wind', () => {
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

  it('turns a wind grid into animated streamlines', () => {
    const [dataset] = framesToDatasets([windFrame()], {}, { windBaseMs: 1_000_000 });

    expect(dataset.rows.length).toBeGreaterThan(0);

    // The rows are trip geometry, not the grid: kepler detects the Trip layer
    // from `_geojson` on its own, so no layer config rides along.
    expect(dataset.tripLayer).toBeUndefined();
    expect(dataset.flowLayer).toBeUndefined();

    const feature = JSON.parse(dataset.rows[0]._geojson as string);
    expect(feature.geometry.type).toBe('LineString');
    expect(feature.geometry.coordinates.every((c: number[]) => c.length === 4)).toBe(true);
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
    expect(dataset.tripLayer).toBeDefined();
  });
});

describe('framesToDatasets — wind with several timesteps', () => {
  it('uses the earliest timestep instead of mixing them', () => {
    // A real wind table carries every hour of the forecast. Left alone, each
    // cell would be overwritten by whichever row happened to come last, which
    // silently draws the wrong hour — here, the wind reversed.
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

    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'lat', type: FieldType.number, values: lat },
        { name: 'lon', type: FieldType.number, values: lon },
        { name: 'time', type: FieldType.time, values: time },
        { name: 'u', type: FieldType.number, values: u },
        { name: 'v', type: FieldType.number, values: u.map(() => 0) },
      ],
    });

    const [dataset] = framesToDatasets([frame], {}, { windBaseMs: 0 });
    const coordinates: number[][] = JSON.parse(dataset.rows[0]._geojson as string).geometry.coordinates;

    // The earliest hour blows east, so longitude must increase along the line.
    expect(coordinates[1][0]).toBeGreaterThan(coordinates[0][0]);
  });
});

describe('framesToDatasets — re-tracing on viewport change', () => {
  const windFrame = () => {
    const lat: number[] = [];
    const lon: number[] = [];
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
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

  it('exposes the field and the clock so the viewport hook can re-trace', () => {
    // Re-tracing must not need the DataFrame again: the viewport changes far
    // more often than the query runs, and rebuilding from the frame each time
    // would tie redraws to Grafana's query lifecycle.
    const [dataset] = framesToDatasets([windFrame()], {}, { windBaseMs: 7_000 });

    expect(dataset.wind?.field.columns).toBe(8);
    expect(dataset.wind?.baseMs).toBe(7_000);
  });

  it('draws denser lines over a smaller viewport', () => {
    // The point of the whole exercise: zooming in must not thin the lines out.
    const frame = windFrame();
    const at = (west: number, east: number) =>
      framesToDatasets([frame], {}, {
        windBaseMs: 0,
        viewport: { west, south: 0, east, north: east - west, widthPx: 800, heightPx: 800 },
      })[0];

    const spanOf = (dataset: ReturnType<typeof at>) => {
      const c: number[][] = JSON.parse(dataset.rows[0]._geojson as string).geometry.coordinates;
      return Math.abs(c[c.length - 1][0] - c[0][0]);
    };

    expect(spanOf(at(0, 8)) / spanOf(at(0, 2))).toBeCloseTo(4, 1);
  });
});

describe('framesToDatasets — several wind layers at once', () => {
  const windFrame = (refId: string) => {
    const lat: number[] = [];
    const lon: number[] = [];
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        lat.push(j);
        lon.push(i);
      }
    }
    return toDataFrame({
      refId,
      fields: [
        { name: 'lat', type: FieldType.number, values: lat },
        { name: 'lon', type: FieldType.number, values: lon },
        { name: 'u', type: FieldType.number, values: lat.map(() => 12) },
        { name: 'v', type: FieldType.number, values: lat.map(() => 0) },
      ],
    });
  };

  it('shares the line budget between the wind layers on screen', () => {
    // The count is a budget for the *screen*, not for each query. Three levels
    // drawing a full allowance each put three times Esri's whole line count into
    // the same pixels, and the levels become impossible to tell apart.
    const [alone] = framesToDatasets([windFrame('A')], {}, { windBaseMs: 0 });
    const three = framesToDatasets([windFrame('A'), windFrame('B'), windFrame('C')], {}, { windBaseMs: 0 });

    expect(three).toHaveLength(3);
    for (const dataset of three) {
      expect(dataset.rows.length).toBeCloseTo(alone.rows.length / 3, -2);
    }
  });

  it('leaves a lone wind layer its whole allowance', () => {
    const [only] = framesToDatasets([windFrame('A'), toDataFrame({ refId: 'B', fields: [] })], {}, { windBaseMs: 0 });
    const [alone] = framesToDatasets([windFrame('A')], {}, { windBaseMs: 0 });

    expect(only.rows.length).toBe(alone.rows.length);
  });

  it('takes the budget from the panel option, still shared between the layers', () => {
    // There is no density that suits every map, so it belongs in the UI rather
    // than in a constant here — a country and a three-kilometre patch around a
    // weather station want very different counts. Sharing has to survive it:
    // an option read per layer would put the whole budget on each level.
    const two = framesToDatasets([windFrame('A'), windFrame('B')], {}, { windBaseMs: 0, windDensity: 1200 });

    expect(two).toHaveLength(2);
    for (const dataset of two) {
      expect(dataset.rows.length).toBeCloseTo(600, -2);
    }
  });
});

describe('framesToDatasets — wind at altitude', () => {
  it('lifts the streamlines to the mapped altitude', () => {
    // Stacking levels only reads as height if the geometry actually carries it.
    // The tracer emits its own third coordinate, so the altitude role has to be
    // handed to it — the column alone does nothing, and every level ends up
    // coplanar on the ground.
    const lat: number[] = [];
    const lon: number[] = [];
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 6; i++) {
        lat.push(j);
        lon.push(i);
      }
    }

    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'lat', type: FieldType.number, values: lat },
        { name: 'lon', type: FieldType.number, values: lon },
        { name: 'u', type: FieldType.number, values: lat.map(() => 10) },
        { name: 'v', type: FieldType.number, values: lat.map(() => 0) },
        { name: 'alt', type: FieldType.number, values: lat.map(() => 37_500) },
      ],
    });

    const [dataset] = framesToDatasets([frame], { A: { altitude: 'alt' } }, { windBaseMs: 0 });
    const coords: number[][] = JSON.parse(dataset.rows[0]._geojson as string).geometry.coordinates;

    expect(coords.every((c) => c[2] === 37_500)).toBe(true);
  });
});

describe('framesToDatasets — stacked levels keep their separation at any zoom', () => {
  const level = (refId: string, altitude: number) => {
    const lat: number[] = [];
    const lon: number[] = [];
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        lat.push(j);
        lon.push(i);
      }
    }
    return toDataFrame({
      refId,
      fields: [
        { name: 'lat', type: FieldType.number, values: lat },
        { name: 'lon', type: FieldType.number, values: lon },
        { name: 'u', type: FieldType.number, values: lat.map(() => 12) },
        { name: 'v', type: FieldType.number, values: lat.map(() => 0) },
        { name: 'alt', type: FieldType.number, values: lat.map(() => altitude) },
      ],
    });
  };

  const mappings = { A: { altitude: 'alt' }, B: { altitude: 'alt' } };

  const drawnHeightOfTop = (halfWidth: number) => {
    const [, top] = framesToDatasets([level('A', 110), level('B', 3000)], mappings, {
      windBaseMs: 0,
      viewport: {
        west: 4 - halfWidth,
        east: 4 + halfWidth,
        south: 4 - halfWidth,
        north: 4 + halfWidth,
        widthPx: 800,
        heightPx: 800,
      },
    });
    return JSON.parse(top.rows[0]._geojson as string).geometry.coordinates[0][2] as number;
  };

  it('scales the stack with the view, so it reads the same close up and far out', () => {
    // A fixed exaggeration cannot serve every zoom: the height that separates the
    // levels nicely over a country is half the screen over a city. Deriving it
    // from the viewport keeps the stack at the same share of the view wherever
    // the user is looking.
    const wide = drawnHeightOfTop(4);
    const close = drawnHeightOfTop(1);

    expect(wide / close).toBeCloseTo(4, 1);
  });

  it('keeps the levels in proportion to each other', () => {
    // The exaggeration is one factor for the whole stack, so 110 m and 3000 m
    // stay in their real ratio — otherwise the levels would be evenly spaced
    // regardless of how far apart they actually are.
    const viewport = { west: 0, east: 8, south: 0, north: 8, widthPx: 800, heightPx: 800 };
    const [bottom, top] = framesToDatasets([level('A', 110), level('B', 3000)], mappings, {
      windBaseMs: 0,
      viewport,
    });

    const heightOf = (d: (typeof bottom)) =>
      JSON.parse(d.rows[0]._geojson as string).geometry.coordinates[0][2] as number;

    expect(heightOf(top) / heightOf(bottom)).toBeCloseTo(3000 / 110, 1);
  });
});
