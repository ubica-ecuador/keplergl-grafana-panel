import {
  altitudeMeaningOf,
  buildVelocityField,
  gridFrameOf,
  latestStepOf,
  latestStepRows,
  legendDescription,
  legendPatch,
  speedColorOf,
  stackedAltitude,
  traceMetresPerPixel,
} from './velocityField';

/** A GridFrame from plain rows, the shape `buildWindField` reads. */
const frameOf = (rows: Array<Record<string, number>>) => ({
  length: rows.length,
  fields: Object.keys(rows[0]).map((name) => ({ name, values: rows.map((row) => row[name]) })),
});

/** Layer columns pointing at the named fields. */
const columnsOf = (names: Record<string, string>) =>
  Object.fromEntries(Object.entries(names).map(([key, value]) => [key, { value }]));

/** A `side` × `side` lattice, one degree apart, each cell filled by `cell`. */
function lattice(side: number, cell: (i: number, j: number) => Record<string, number>) {
  const rows: Array<Record<string, number>> = [];
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      rows.push({ latitude: j, longitude: i, ...cell(i, j) });
    }
  }
  return rows;
}

const COMPONENTS = { lat: 'latitude', lng: 'longitude', u: 'u', v: 'v' };

/** One filter as kepler leaves it in a dataset's filter record, for the tests below. */
type FakeFilter = { type?: string; value?: unknown; name?: unknown };

/** A kepler-shaped dataset: columns by name, rows as arrays of values. */
function datasetOf(
  fields: Array<{ name: string; type?: string; filterProps?: { mappedValue?: unknown[] } }>,
  rows: unknown[][],
  filteredIndex?: number[],
  filterRecord?: { cpu?: FakeFilter[]; gpu?: FakeFilter[] }
) {
  return {
    fields,
    filteredIndex,
    filterRecord,
    dataContainer: {
      numRows: () => rows.length,
      valueAt: (row: number, column: number) => rows[row][column],
    },
  };
}

describe('buildVelocityField', () => {
  it('reads u and v in the components mode', () => {
    const field = buildVelocityField(frameOf(lattice(3, () => ({ u: 5, v: 0 }))), columnsOf(COMPONENTS), 'components', {}, 0);

    expect(field!.columns).toBe(3);
    expect(field!.data[0]).toBe(5);
    expect(field!.data[1]).toBe(0);
  });

  it('reads a direction as where the wind comes from in the polar mode', () => {
    // 270° is a westerly: air moving east, so u is positive.
    const field = buildVelocityField(
      frameOf(lattice(3, () => ({ ws: 10, wd: 270 }))),
      columnsOf({ lat: 'latitude', lng: 'longitude', speed: 'ws', direction: 'wd' }),
      'polar',
      {},
      0
    );

    expect(field!.data[0]).toBeCloseTo(10, 5);
    expect(field!.data[1]).toBeCloseTo(0, 5);
  });

  it('reads the direction as where the flow goes when the layer says so', () => {
    const field = buildVelocityField(
      frameOf(lattice(3, () => ({ ws: 10, wd: 270 }))),
      columnsOf({ lat: 'latitude', lng: 'longitude', speed: 'ws', direction: 'wd' }),
      'polar',
      { directionConvention: 'towards' },
      0
    );

    expect(field!.data[0]).toBeCloseTo(-10, 5);
  });

  it('describes no field without both coordinates', () => {
    const rows = frameOf(lattice(3, () => ({ u: 5, v: 0 })));

    expect(buildVelocityField(rows, columnsOf({ lng: 'longitude', u: 'u', v: 'v' }), 'components', {}, 0)).toBeNull();
  });

  it('smooths by the default the caller gives when the layer carries no answer', () => {
    // One gust in still air. Left alone it stays at 100; smoothed, the blur
    // spreads it into its neighbours and the centre drops.
    const rows = frameOf(lattice(5, (i, j) => ({ u: i === 2 && j === 2 ? 100 : 0, v: 0 })));
    const centre = 2 * (2 * 5 + 2);

    const raw = buildVelocityField(rows, columnsOf(COMPONENTS), 'components', {}, 0);
    const smoothed = buildVelocityField(rows, columnsOf(COMPONENTS), 'components', {}, 2);

    expect(raw!.data[centre]).toBe(100);
    expect(smoothed!.data[centre]).toBeLessThan(100);
  });
});

describe('legendPatch', () => {
  it('writes the scale, the range and the measure the legend reads', () => {
    expect(legendPatch({ columnMode: 'components', visConfig: {} }, [12, 13])).toEqual({
      flowColorScale: 'quantize',
      flowColorDomain: [12, 13],
      flowColorField: { name: 'speed', displayName: 'Speed', type: 'real' },
    });
  });

  it('answers nothing when the legend already says it', () => {
    // It runs on every animation frame of the flow field; a config rewritten
    // sixty times a second re-renders every panel that reads it.
    const config: Record<string, unknown> = { columnMode: 'components', visConfig: {} };
    Object.assign(config, legendPatch(config, [12, 13]));

    expect(legendPatch(config, [12, 13])).toBeNull();
  });

  it('follows a range set by hand', () => {
    const patch = legendPatch({ visConfig: { fixedSpeedRange: true, speedRange: [0, 40] } }, [12, 13]);

    expect(patch!.flowColorDomain).toEqual([0, 40]);
  });

  it('calls the measure a slope in the gradient mode', () => {
    const patch = legendPatch({ columnMode: 'gradient', visConfig: {} }, [0, 1]);

    expect(patch!.flowColorField).toEqual({ name: 'slope', displayName: 'Slope', type: 'real' });
  });
});

describe('legendDescription', () => {
  const written = { visConfig: {}, flowColorField: { displayName: 'Speed' } };

  it('names the measure of the colour channel', () => {
    expect(legendDescription(written, 'color')).toEqual({ label: '', measure: 'Speed' });
  });

  it('leaves any other channel to kepler', () => {
    expect(legendDescription(written, 'size')).toBeNull();
  });

  it('leaves the single colour to kepler when the lines are not coloured by speed', () => {
    expect(legendDescription({ ...written, visConfig: { colorBySpeed: false } }, 'color')).toBeNull();
  });
});

describe('speedColorOf', () => {
  const RAMP = ['#000000', '#ffffff'];
  const domain: [number, number] = [0, 20];

  it('colours by speed when the ramp says so', () => {
    expect(speedColorOf({ colorBySpeed: true }, RAMP, [9, 9, 9], domain)(10)).toEqual([255, 255, 255]);
  });

  it('adds an alpha from the calm opacity up to opaque when opacity follows speed', () => {
    // 0.2, plus half of the remaining 0.8, is 153 of 255.
    expect(
      speedColorOf({ colorBySpeed: true, opacityBySpeed: true, calmOpacity: 0.2 }, RAMP, [9, 9, 9], domain)(10)
    ).toEqual([255, 255, 255, 153]);
  });

  it("falls back to the layer's one colour when it is not coloured by speed", () => {
    expect(speedColorOf({ colorBySpeed: false }, RAMP, [9, 9, 9], domain)(10)).toEqual([9, 9, 9]);
  });
});

describe('stackedAltitude', () => {
  // Takes the level's metres directly rather than a frame and columns: reading
  // the column is `altitudeMeaningOf`'s job now, and only it knows whether
  // there even is a single height to exaggerate — see `altitudeMeaningOf`.
  it('passes the metres through unchanged with no camera and no exaggeration', () => {
    expect(stackedAltitude(2500, {}, { tallest: 0 }, null)).toBe(2500);
  });

  it('is scaled by the elevation knob', () => {
    expect(stackedAltitude(2500, { elevationScale: 2 }, { tallest: 0 }, null)).toBe(5000);
  });
});

describe('traceMetresPerPixel', () => {
  /** Web Mercator's metres per pixel at the centre of a 512-px world, as deck works it out. */
  const mercator = (zoom: number, latitude: number) =>
    (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
  const steps = (metresPerPixel: number) => Math.log2(traceMetresPerPixel(metresPerPixel)) * 16;

  it('lands on steps a sixteenth of a doubling apart, never more than half a step off', () => {
    for (const metresPerPixel of [0.3, 12.7, 611.5, 9_784]) {
      expect(steps(metresPerPixel)).toBeCloseTo(Math.round(steps(metresPerPixel)), 9);
      expect(Math.abs(Math.log2(traceMetresPerPixel(metresPerPixel) / metresPerPixel))).toBeLessThanOrEqual(1 / 32);
      // And a step is a step: snapping twice changes nothing.
      expect(traceMetresPerPixel(traceMetresPerPixel(metresPerPixel))).toBe(traceMetresPerPixel(metresPerPixel));
    }
  });

  it('keeps one scale for a pan across Ecuador at a fixed zoom, and moves for any zoom of a sixteenth or more', () => {
    // A pan at a fixed zoom moves the metres a pixel covers only through the
    // latitude of the centre; the flow field keeps its lines for as long as
    // this holds, so a pan must not move it and a zoom must.
    const here = traceMetresPerPixel(mercator(7, -2));
    expect(traceMetresPerPixel(mercator(7, -3))).toBe(here);
    expect(traceMetresPerPixel(mercator(7, 1))).toBe(here);
    for (const zoom of [7 + 1 / 16, 7.1, 7.4, 6.9]) {
      expect(traceMetresPerPixel(mercator(zoom, -2))).not.toBe(here);
    }
  });

  it('snaps the height of a lifted level with it, so a level drawn twice sits at one height', () => {
    // The vector field hands `stackedAltitude` the camera as it is, and the
    // flow field the camera at the snapped scale: both have to come out the same.
    const camera = (metresPerPixel: number) => ({
      widthPx: 800,
      heightPx: 600,
      bounds: { west: 0, east: 1, south: 0, north: 1 },
      metresPerPixel,
      unproject: () => null,
    });
    const raw = 611.5;
    expect(stackedAltitude(3000, {}, { tallest: 3000 }, camera(raw))).toBe(
      stackedAltitude(3000, {}, { tallest: 3000 }, camera(traceMetresPerPixel(raw)))
    );
  });
});

describe('altitudeMeaningOf', () => {
  /** A frame of one column, in the shape `GridFrame` asks for. */
  const columnFrame = (name: string, values: number[]) => ({
    length: values.length,
    fields: [{ name, values: Float64Array.from(values) }],
  });

  it('reads a column that never changes as the height of this level', () => {
    expect(altitudeMeaningOf(columnFrame('altitude', [1500, 1500, 1500]), 'altitude', {})).toEqual({
      kind: 'level',
      metres: 1500,
    });
  });

  it('reads a column that varies as terrain', () => {
    // The bug this ends: the first finite value won, so a terrain column was
    // silently flattened into one height and the lines floated over it.
    expect(altitudeMeaningOf(columnFrame('altitude', [2400, 2600, 3100]), 'altitude', {})).toEqual({
      kind: 'terrain',
    });
  });

  it('falls back to the knob when no column is bound', () => {
    expect(altitudeMeaningOf({ length: 0, fields: [] }, null, { heightMeters: 850 })).toEqual({
      kind: 'level',
      metres: 850,
    });
  });

  it('reads a float32-rounded constant as a level, not as terrain', () => {
    // 1500.1 has no exact float32 representation, so a query that returns it
    // through a float32 column can round to a slightly different float64 value
    // than the literal itself — genuinely the same level, differing only in
    // storage. An absolute tolerance of 1e-6 is finer than that rounding error
    // (about 2.4e-5 here) and would misread this single, constant level as
    // terrain.
    const rounded = Math.fround(1500.1);
    expect(altitudeMeaningOf(columnFrame('altitude', [rounded, 1500.1, rounded]), 'altitude', {})).toEqual({
      kind: 'level',
      metres: rounded,
    });
  });
});

describe('latestStepRows', () => {
  const FIELDS = [
    { name: 'time', type: 'timestamp' },
    { name: 'lat', type: 'real' },
    { name: 'lng', type: 'real' },
  ];
  // Two cells, two hours.
  const ROWS = [
    [1_000, 0, 0],
    [1_000, 0, 1],
    [2_000, 0, 0],
    [2_000, 0, 1],
  ];

  it('keeps the rows of the latest hour', () => {
    // Without this every cell is written twice and whichever row came last
    // wins — which for a wind that reverses is the opposite of the truth.
    expect(latestStepRows(datasetOf(FIELDS, ROWS))).toEqual([2, 3]);
  });

  it('is the latest hour the filter left standing, not the latest there is', () => {
    // This is the whole of the clock: kepler's time filter hides the rows
    // outside its window, and the layer draws the most recent of what is left.
    expect(latestStepRows(datasetOf(FIELDS, ROWS, [0, 1]))).toEqual([0, 1]);
  });

  it('reads every row when the query carries no time', () => {
    const fields = [{ name: 'lat', type: 'real' }, { name: 'lng', type: 'real' }];
    expect(latestStepRows(datasetOf(fields, [[0, 0], [0, 1]]))).toEqual([0, 1]);
  });

  // kepler sorts a `timestamp` field's filter into GPU mode by default
  // (`getFilterProps`), and a GPU filter's own value narrowing never reaches
  // `filteredIndex` — `KeplerTable.filterTable` only recomputes that for
  // filters it sorts into `filterRecord.cpu`. Measured in the browser:
  // dragging the map's time filter left `filteredIndex` holding every row
  // while `dataset.filterRecord.gpu` carried the real, narrowed window. Without
  // reading the record, the map's clock has no way to reach this layer at all.
  it('is the latest hour the filter left standing even when the filter runs on the GPU', () => {
    const filterRecord = { gpu: [{ type: 'timeRange', value: [500, 1_500], name: ['time'] }] };
    expect(latestStepRows(datasetOf(FIELDS, ROWS, undefined, filterRecord))).toEqual([0, 1]);
  });

  // Checked defensively rather than for a specific kepler mechanism that would
  // move it there: this costs nothing and keeps working whichever bucket a
  // future kepler version happens to sort a time filter into.
  it('checks the CPU bucket too, in case kepler ever sorts the time filter there', () => {
    const filterRecord = { cpu: [{ type: 'timeRange', value: [500, 1_500], name: ['time'] }] };
    expect(latestStepRows(datasetOf(FIELDS, ROWS, undefined, filterRecord))).toEqual([0, 1]);
  });

  it('ignores a time-range filter bound to a different column', () => {
    // Some other dataset's time filter, sharing this one's filter record only
    // because kepler carries every filter that could apply to this dataId —
    // it must not be read as this field's own window.
    const filterRecord = { gpu: [{ type: 'timeRange', value: [500, 1_500], name: ['other'] }] };
    expect(latestStepRows(datasetOf(FIELDS, ROWS, undefined, filterRecord))).toEqual([2, 3]);
  });

  it('reads no rows when the window holds none of the hours', () => {
    // Not a reason to fall back to every row: the map's clock is looking at a
    // stretch of the forecast this dataset has nothing in.
    const filterRecord = { gpu: [{ type: 'timeRange', value: [3_000, 4_000], name: ['time'] }] };
    expect(latestStepRows(datasetOf(FIELDS, ROWS, undefined, filterRecord))).toEqual([]);
  });

  it('keeps a sample exactly on the window\'s edge, both ends included', () => {
    // `pickLatestWithin`'s own rule for the WMS: `time < from || time > to` is
    // excluded, so a sample sitting exactly on either edge stays in.
    const atFrom = { gpu: [{ type: 'timeRange', value: [1_000, 1_999], name: ['time'] }] };
    expect(latestStepRows(datasetOf(FIELDS, ROWS, undefined, atFrom))).toEqual([0, 1]);

    const atTo = { gpu: [{ type: 'timeRange', value: [0, 2_000], name: ['time'] }] };
    expect(latestStepRows(datasetOf(FIELDS, ROWS, undefined, atTo))).toEqual([2, 3]);
  });

  // kepler keeps an ISO-string timestamp raw in the data container — only the
  // already-numeric `x`/`X` formats are converted by its own parser — and
  // instead compares it through `field.filterProps.mappedValue`, a per-row
  // numeric reading it computes once a filter binds to the column.
  // `Number("2026-01-01T00:00:00Z")` is `NaN`, so without reading that mapping
  // first, every row failed the window and the field drew nothing at all.
  it('reads an ISO-string time column through kepler\'s own mapped value', () => {
    const fields = [
      { name: 'time', type: 'timestamp', filterProps: { mappedValue: [1_000, 2_000] } },
      { name: 'lat', type: 'real' },
    ];
    const rows = [
      ['2026-01-01T00:00:00.000Z', 0],
      ['2026-01-01T00:00:02.000Z', 0],
    ];
    expect(latestStepRows(datasetOf(fields, rows))).toEqual([1]);
  });
});

describe('latestStepOf', () => {
  it('names the hour on show, so a cache can be kept by it', () => {
    const fields = [{ name: 'time', type: 'timestamp' }, { name: 'lat', type: 'real' }];
    expect(latestStepOf(datasetOf(fields, [[1_000, 0], [2_000, 0]]))).toBe(2_000);
  });

  it('answers null when there is no time column to name an hour with', () => {
    expect(latestStepOf(datasetOf([{ name: 'lat', type: 'real' }], [[0]]))).toBeNull();
  });

  // The hour is the key both layers' caches and fast paths are kept by. Read as
  // `Number(valueAt(...))`, an ISO-string column named every hour `null`: the
  // same name for all of them, so once kepler had narrowed the table in place
  // — same container, same signature — the layers handed back the first hour
  // they drew for ever, whichever hour the map's clock was on.
  it('names the hour of an ISO-string time column through kepler\'s own mapped value', () => {
    const first = Date.parse('2026-01-01T00:00:00Z');
    const fields = [
      { name: 'time', type: 'timestamp', filterProps: { mappedValue: [first, first + 3_600_000] } },
      { name: 'lat', type: 'real' },
    ];
    const rows = [
      ['2026-01-01T00:00:00.000Z', 0],
      ['2026-01-01T01:00:00.000Z', 0],
    ];

    expect(latestStepOf(datasetOf(fields, rows))).toBe(first + 3_600_000);
  });
});

describe('gridFrameOf', () => {
  it('materialises only the rows of the hour on show', () => {
    const fields = [
      { name: 'time', type: 'timestamp' },
      { name: 'lat', type: 'real' },
      { name: 'lng', type: 'real' },
    ];
    const dataset = datasetOf(fields, [
      [1_000, 0, 0],
      [2_000, 9, 9],
    ]);
    const columns = { lat: { value: 'lat', fieldIdx: 1 }, lng: { value: 'lng', fieldIdx: 2 } };

    const frame = gridFrameOf(dataset, columns)!;

    expect(frame.length).toBe(1);
    expect(Array.from(frame.fields.find((f) => f.name === 'lat')!.values)).toEqual([9]);
  });
});
