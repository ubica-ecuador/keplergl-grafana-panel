import { FieldType, toDataFrame } from '@grafana/data';

import { buildWindField, sampleWindField, smoothWindField, WindField } from './buildWindField';

describe('buildWindField', () => {
  it('builds a field from a regular u/v grid and samples it at a node', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 0, 1, 1] },
        { name: 'lon', type: FieldType.number, values: [0, 1, 0, 1] },
        { name: 'u', type: FieldType.number, values: [1, 2, 3, 4] },
        { name: 'v', type: FieldType.number, values: [10, 20, 30, 40] },
      ],
    });

    const field = buildWindField(frame, { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v' });

    expect(field).not.toBeNull();
    expect(field!.columns).toBe(2);
    expect(field!.rows).toBe(2);
    expect(sampleWindField(field!, 0, 0)).toEqual([1, 10]);
    expect(sampleWindField(field!, 1, 1)).toEqual([4, 40]);
  });

  it('reads direction as the bearing the wind blows FROM, not towards', () => {
    // The meteorological convention every source uses — Open-Meteo, GFS, INAMHI.
    // A "north wind" (0°) travels southwards, so v must come out negative. Read
    // the other way round the whole field is mirrored and rotated.
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 0, 1, 1] },
        { name: 'lon', type: FieldType.number, values: [0, 1, 0, 1] },
        { name: 'speed', type: FieldType.number, values: [5, 5, 5, 5] },
        { name: 'dir', type: FieldType.number, values: [0, 90, 180, 270] },
      ],
    });

    const field = buildWindField(frame, {
      latitude: 'lat',
      longitude: 'lon',
      speed: 'speed',
      direction: 'dir',
    })!;

    // sin/cos leave float dust — and `Math.round(-1e-16)` is `-0`, which Jest
    // does not consider equal to `0`. Collapse anything negligible to zero.
    const tidy = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n));
    const round = ([u, v]: [number, number]) => [tidy(u), tidy(v)];

    expect(round(sampleWindField(field, 0, 0)!)).toEqual([0, -5]); // from N → towards S
    expect(round(sampleWindField(field, 1, 0)!)).toEqual([-5, 0]); // from E → towards W
    expect(round(sampleWindField(field, 0, 1)!)).toEqual([0, 5]); // from S → towards N
    expect(round(sampleWindField(field, 1, 1)!)).toEqual([5, 0]); // from W → towards E
  });

  it('interpolates bilinearly between nodes', () => {
    // Without this a 0.25° grid makes particles jump from cell to cell and the
    // traced lines come out as staircases.
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 0, 1, 1] },
        { name: 'lon', type: FieldType.number, values: [0, 1, 0, 1] },
        { name: 'u', type: FieldType.number, values: [0, 10, 0, 10] },
        { name: 'v', type: FieldType.number, values: [0, 0, 20, 20] },
      ],
    });

    const field = buildWindField(frame, { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v' })!;

    expect(sampleWindField(field, 0.5, 0)).toEqual([5, 0]);
    expect(sampleWindField(field, 0, 0.5)).toEqual([0, 10]);
    expect(sampleWindField(field, 0.5, 0.5)).toEqual([5, 10]);
  });

  it('builds the same grid when the query returns rows in any order', () => {
    const ordered = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 0, 1, 1] },
        { name: 'lon', type: FieldType.number, values: [0, 1, 0, 1] },
        { name: 'u', type: FieldType.number, values: [1, 2, 3, 4] },
        { name: 'v', type: FieldType.number, values: [10, 20, 30, 40] },
      ],
    });
    const shuffled = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [1, 0, 1, 0] },
        { name: 'lon', type: FieldType.number, values: [1, 0, 0, 1] },
        { name: 'u', type: FieldType.number, values: [4, 1, 3, 2] },
        { name: 'v', type: FieldType.number, values: [40, 10, 30, 20] },
      ],
    });

    const cols = { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v' };

    expect(buildWindField(shuffled, cols)!.data).toEqual(buildWindField(ordered, cols)!.data);
  });

  it('returns null when sampled outside the grid', () => {
    // This is the signal the tracer uses to end a streamline at the edge of the
    // domain rather than extrapolating into data that does not exist.
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 0, 1, 1] },
        { name: 'lon', type: FieldType.number, values: [0, 1, 0, 1] },
        { name: 'u', type: FieldType.number, values: [1, 1, 1, 1] },
        { name: 'v', type: FieldType.number, values: [1, 1, 1, 1] },
      ],
    });

    const field = buildWindField(frame, { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v' })!;

    expect(sampleWindField(field, -0.5, 0.5)).toBeNull();
    expect(sampleWindField(field, 1.5, 0.5)).toBeNull();
    expect(sampleWindField(field, 0.5, -0.5)).toBeNull();
    expect(sampleWindField(field, 0.5, 1.5)).toBeNull();
    expect(sampleWindField(field, 0.5, 0.5)).not.toBeNull();
  });

  it('returns null when the query does not describe a grid', () => {
    const single = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 0] },
        { name: 'lon', type: FieldType.number, values: [0, 1] },
        { name: 'u', type: FieldType.number, values: [1, 2] },
        { name: 'v', type: FieldType.number, values: [1, 2] },
      ],
    });

    // One row of latitudes is a transect, not a field: there is nothing to
    // interpolate across and the tracer would divide by a zero-height cell.
    expect(buildWindField(single, { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v' })).toBeNull();
  });

  it('returns null when neither components nor speed+direction are present', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 0, 1, 1] },
        { name: 'lon', type: FieldType.number, values: [0, 1, 0, 1] },
        { name: 'speed', type: FieldType.number, values: [1, 2, 3, 4] },
      ],
    });

    expect(buildWindField(frame, { latitude: 'lat', longitude: 'lon', speed: 'speed' })).toBeNull();
  });

  it('treats a cell the query never returned as a hole, not as calm air', () => {
    // Masking is how the cordillera gets excluded: over Ecuador the 850 hPa
    // surface is underground across ~18% of the country, and the honest query
    // simply omits those cells. Left as zeros they would read as dead calm —
    // indistinguishable from real still air, and the streamlines would fade out
    // instead of stopping.
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [0, 0, 1] }, // falta (lat 1, lon 1)
        { name: 'lon', type: FieldType.number, values: [0, 1, 0] },
        { name: 'u', type: FieldType.number, values: [5, 5, 5] },
        { name: 'v', type: FieldType.number, values: [5, 5, 5] },
      ],
    });

    const field = buildWindField(frame, { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v' })!;

    expect(sampleWindField(field, 0.5, 0.5)).toBeNull();
  });

  it('returns null next to a hole in the grid', () => {
    // Real fields have holes. Over Ecuador the 850 hPa surface is underground
    // across ~18% of the country — the whole cordillera — so those cells carry
    // no wind. Bilinear interpolation would spread one NaN corner over the
    // surrounding cell, and NaN fails every comparison silently, so the caller
    // must be told rather than handed a number that is not one.
    // 4×4 nodos, con un único nodo sin dato en (columna 1, fila 1). Hace falta
    // esa holgura: en una malla 3×3 con el agujero en el centro, las cuatro
    // celdas lo tocan y no queda ninguna válida con la que contrastar.
    const node = (column: number, row: number) => (column === 1 && row === 1 ? [NaN, NaN] : [1, 1]);
    const data = new Float32Array(4 * 4 * 2);
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        const [u, v] = node(column, row);
        data[2 * (row * 4 + column)] = u;
        data[2 * (row * 4 + column) + 1] = v;
      }
    }

    const withHole: WindField = { data, columns: 4, rows: 4, west: 0, south: 0, stepLon: 1, stepLat: 1 };

    // Las celdas con el agujero en una esquina no pueden interpolarse.
    expect(sampleWindField(withHole, 0.5, 0.5)).toBeNull();
    expect(sampleWindField(withHole, 1.5, 1.5)).toBeNull();
    // Una celda lejos del agujero sigue siendo válida.
    expect(sampleWindField(withHole, 2.5, 2.5)).toEqual([1, 1]);
  });
});

describe('smoothWindField', () => {
  /** A field of `size × size` nodes, filled by a function of (column, row). */
  const build = (size: number, at: (column: number, row: number) => [number, number]): WindField => {
    const data = new Float32Array(size * size * 2);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const [u, v] = at(column, row);
        data[2 * (row * size + column)] = u;
        data[2 * (row * size + column) + 1] = v;
      }
    }
    return { data, columns: size, rows: size, west: 0, south: 0, stepLon: 1, stepLat: 1 };
  };

  const nodeAt = (field: WindField, column: number, row: number) => {
    const k = 2 * (row * field.columns + column);
    return [field.data[k], field.data[k + 1]];
  };

  it('spreads a spike into its neighbours', () => {
    // GFS at 0.25° carries high-frequency detail the tracer cannot use: it makes
    // particles jitter between adjacent cells. Esri smooths before tracing for
    // exactly this reason.
    const spiky = build(7, (column, row) => (column === 3 && row === 3 ? [10, 0] : [0, 0]));

    const smoothed = smoothWindField(spiky, 1);

    expect(nodeAt(smoothed, 3, 3)[0]).toBeLessThan(10);
    expect(nodeAt(smoothed, 2, 3)[0]).toBeGreaterThan(0);
    expect(nodeAt(smoothed, 4, 3)[0]).toBeGreaterThan(0);
  });

  it('leaves a hole a hole instead of filling it in', () => {
    // The masked cordillera must stay empty. Smoothing wind into it would undo
    // the whole point of masking and draw flow over ground the level is beneath.
    const withHole = build(7, (column, row) => (column === 3 && row === 3 ? [NaN, NaN] : [4, 0]));

    const smoothed = smoothWindField(withHole, 1);

    expect(Number.isNaN(nodeAt(smoothed, 3, 3)[0])).toBe(true);
  });

  it('smooths a cell beside a hole from its valid neighbours only', () => {
    // Averaging NaN in would spread the hole outwards a ring per pass until the
    // whole field vanished.
    const withHole = build(7, (column, row) => (column === 3 && row === 3 ? [NaN, NaN] : [4, 0]));

    const smoothed = smoothWindField(withHole, 1);

    expect(nodeAt(smoothed, 2, 3)[0]).toBeCloseTo(4, 5);
  });
});

describe('buildWindField — scattered points are not a field', () => {
  it('refuses a handful of stations instead of inventing a grid from them', () => {
    // A few weather stations are not a velocity field. Left to infer a grid from
    // them, the spacing comes out of whatever gap happens to be smallest and the
    // rest of the rows land nowhere near it — so the map draws almost nothing
    // and says nothing about why. Refusing is what lets the caller fall back to
    // drawing them as the points they are.
    const stations = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [-0.18, -2.19, -3.99, -1.05, -2.9] },
        { name: 'lon', type: FieldType.number, values: [-78.47, -79.89, -79.2, -80.45, -79.0] },
        { name: 'speed', type: FieldType.number, values: [3, 5, 2, 6, 4] },
        { name: 'direction', type: FieldType.number, values: [90, 120, 80, 100, 110] },
      ],
    });

    expect(
      buildWindField(stations, { latitude: 'lat', longitude: 'lon', speed: 'speed', direction: 'direction' })
    ).toBeNull();
  });

  it('still accepts a grid with whole rows or columns missing', () => {
    // Masking removes cells — over Ecuador it removes the entire cordillera — so
    // the check has to tolerate gaps in the lattice without tolerating rows that
    // never sat on one.
    const lat: number[] = [];
    const lon: number[] = [];
    for (const y of [0, 1, 2, 3]) {
      for (const x of [0, 1, 3]) {
        // falta la columna x = 2
        lat.push(y);
        lon.push(x);
      }
    }

    const masked = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: lat },
        { name: 'lon', type: FieldType.number, values: lon },
        { name: 'u', type: FieldType.number, values: lat.map(() => 5) },
        { name: 'v', type: FieldType.number, values: lat.map(() => 0) },
      ],
    });

    expect(buildWindField(masked, { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v' })).not.toBeNull();
  });
});
