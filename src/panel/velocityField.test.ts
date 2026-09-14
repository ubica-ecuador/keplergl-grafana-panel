import { buildVelocityField, legendDescription, legendPatch, speedColorOf, stackedAltitude } from './velocityField';

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
  // Only `columns` and `visConfig` are read when there is no altitude column
  // bound, so a single arbitrary row is enough of a frame.
  const frame = frameOf([{ latitude: 0, longitude: 0 }]);

  it('rests on the height knob with no altitude column and no camera', () => {
    expect(stackedAltitude(frame, {}, { heightMeters: 2500 }, { baseMs: 0, tallest: 0 }, null)).toBe(2500);
  });

  it('is scaled by the elevation knob', () => {
    expect(
      stackedAltitude(frame, {}, { heightMeters: 2500, elevationScale: 2 }, { baseMs: 0, tallest: 0 }, null)
    ).toBe(5000);
  });
});
