/**
 * The little of a Grafana `DataFrame` this module reads.
 *
 * Named rather than imported so a kepler `DataContainer` can pose as one: the
 * field is built inside the layer now, from the columns kepler holds, and a real
 * `DataFrame` satisfies this shape without being told to.
 */
export interface GridFrame {
  length: number;
  fields: Array<{ name: string; values: ArrayLike<unknown> }>;
}

/** A velocity field discretised on a regular lat/lon grid. */
export interface WindField {
  /** Interleaved `u,v` per cell, row-major from the south-west corner. */
  data: Float32Array;
  columns: number;
  rows: number;
  west: number;
  south: number;
  stepLon: number;
  stepLat: number;
}

/** The columns a wind query supplies, by name. */
export interface WindFieldColumns {
  latitude: string;
  longitude: string;
  u?: string;
  v?: string;
  speed?: string;
  direction?: string;
  /**
   * When the query spans several timesteps, the column that separates them.
   * Only the earliest is used — see `earliestTimestepRows`.
   */
  time?: string;
}

export function buildWindField(frame: GridFrame, columns: WindFieldColumns): WindField | null {
  const field = (name?: string) => (name ? frame.fields.find((f) => f.name === name) : undefined);

  const latField = field(columns.latitude);
  const lonField = field(columns.longitude);
  const uField = field(columns.u);
  const vField = field(columns.v);
  const speedField = field(columns.speed);
  const directionField = field(columns.direction);

  const hasComponents = Boolean(uField && vField);
  const hasPolar = Boolean(speedField && directionField);

  if (!latField || !lonField || (!hasComponents && !hasPolar)) {
    return null;
  }

  // Components win when both are present: they need no convention to interpret.
  const componentsAt = hasComponents
    ? (i: number): [number, number] => [Number(uField!.values[i]), Number(vField!.values[i])]
    : (i: number): [number, number] =>
        speedDirToUV(Number(speedField!.values[i]), Number(directionField!.values[i]));

  const indices = earliestTimestepRows(frame, columns.time);

  const lats = axisOf(indices.map((i) => Number(latField.values[i])));
  const lons = axisOf(indices.map((i) => Number(lonField.values[i])));
  if (!lats || !lons) {
    return null;
  }

  // NaN, not the default zero: a cell the query never returned is missing data,
  // and zero would read as dead calm — indistinguishable from real still air,
  // and worse, bilinear interpolation would blend that fake zero into the
  // neighbouring cells. Masking is the normal case, not an edge case: an honest
  // query omits the cells where the pressure level is underground.
  const data = new Float32Array(lons.count * lats.count * 2).fill(NaN);

  for (const i of indices) {
    const column = Math.round((Number(lonField.values[i]) - lons.min) / lons.step);
    const row = Math.round((Number(latField.values[i]) - lats.min) / lats.step);
    const k = 2 * (row * lons.count + column);
    const [u, v] = componentsAt(i);
    data[k] = u;
    data[k + 1] = v;
  }

  return {
    data,
    columns: lons.count,
    rows: lats.count,
    west: lons.min,
    south: lats.min,
    stepLon: lons.step,
    stepLat: lats.step,
  };
}

/** Which way a scalar field is read as a flow. */
export type GradientDirection = 'downhill' | 'uphill' | 'contours';

/** The columns a gradient query supplies, by name. */
export interface GradientColumns {
  latitude: string;
  longitude: string;
  /** The scalar the flow is derived from: terrain, pressure, temperature. */
  value: string;
  /** As in `WindFieldColumns` — only the earliest timestep is used. */
  time?: string;
}

/** A scalar sampled on the same regular lattice a `WindField` uses. */
interface ScalarField {
  /** One value per cell, row-major from the south-west corner; NaN for a hole. */
  data: Float32Array;
  columns: number;
  rows: number;
  west: number;
  south: number;
  stepLon: number;
  stepLat: number;
}

const METRES_PER_DEGREE_LAT = 111_320;

/**
 * A velocity field derived from a scalar one, by its gradient.
 *
 * Water runs down a hill the way air runs along a pressure field, so a single
 * scalar column — terrain, pressure, temperature, a rainfall anomaly — already
 * describes a flow, and the streamlines this layer draws are the right picture
 * of it. The calculation follows kepler.gl#3722, which added the same idea
 * upstream for elevation alone.
 *
 * The result is an ordinary `WindField`, so nothing downstream has to know a
 * gradient from a wind. What does change is the unit: these vectors are a
 * *slope*, metres of fall per metre travelled, not metres per second. Nothing
 * in the tracer minds — it normalises the animation to a legible number of
 * pixels per cycle either way — but the colour ramp means slope here.
 */
export function buildGradientField(
  frame: GridFrame,
  columns: GradientColumns,
  options: { direction?: GradientDirection; smoothing?: number } = {}
): WindField | null {
  const scalar = buildScalarField(frame, columns);
  if (!scalar) {
    return null;
  }

  // Smoothing is not optional decoration here: a derivative amplifies whatever
  // noise the samples carry, and one bad pixel in a terrain model becomes a pit
  // steep enough to turn the flow beside it right back up the true slope.
  //
  // It is applied to the scalar rather than to the vectors afterwards, though
  // the two are nearly the same arithmetic — a Gaussian and a derivative are
  // both linear, so they commute wherever the kernel is whole. Measured on a
  // ramp with a spike and a hole, the interior differed by 7% of the slope and
  // only the border, where the differences turn one-sided, by more. The reason
  // to do it here is what the knob then means: it smooths the ground, which is
  // the thing the user can see, and the layer's gradient branch stays one call.
  const data = blurGrid(
    scalar.data,
    { columns: scalar.columns, rows: scalar.rows, channels: 1 },
    options.smoothing ?? 0
  );

  return gradientOf({ ...scalar, data }, options.direction ?? 'downhill');
}

/** The scalar the rows describe, on the lattice they sit on. */
function buildScalarField(frame: GridFrame, columns: GradientColumns): ScalarField | null {
  const field = (name: string) => frame.fields.find((f) => f.name === name);

  const latField = field(columns.latitude);
  const lonField = field(columns.longitude);
  const valueField = field(columns.value);
  if (!latField || !lonField || !valueField) {
    return null;
  }

  const indices = earliestTimestepRows(frame, columns.time);

  const lats = axisOf(indices.map((i) => Number(latField.values[i])));
  const lons = axisOf(indices.map((i) => Number(lonField.values[i])));
  if (!lats || !lons) {
    return null;
  }

  // NaN for the same reason the velocity grid uses it: a cell the query never
  // returned is missing data, and zero is a height like any other — read as one
  // it would carve a pit into the terrain and every streamline would run into
  // it.
  const data = new Float32Array(lons.count * lats.count).fill(NaN);

  for (const i of indices) {
    const value = Number(valueField.values[i]);
    if (!Number.isFinite(value)) {
      continue;
    }
    const column = Math.round((Number(lonField.values[i]) - lons.min) / lons.step);
    const row = Math.round((Number(latField.values[i]) - lats.min) / lats.step);
    data[row * lons.count + column] = value;
  }

  return {
    data,
    columns: lons.count,
    rows: lats.count,
    west: lons.min,
    south: lats.min,
    stepLon: lons.step,
    stepLat: lats.step,
  };
}

/** The scalar's gradient, as a velocity field. */
function gradientOf(scalar: ScalarField, direction: GradientDirection): WindField {
  const { columns, rows, stepLon, stepLat, west, south } = scalar;
  const data = new Float32Array(columns * rows * 2).fill(NaN);

  for (let row = 0; row < rows; row++) {
    // Longitude degrees shrink away from the equator, so the same step spans
    // fewer metres the further north or south a row sits — and a slope measured
    // in degrees rather than metres would steepen towards the poles without the
    // ground changing at all. Clamped near the poles, where the cosine runs to
    // zero and the slope to infinity.
    const latitude = south + row * stepLat;
    const metresEast =
      stepLon * METRES_PER_DEGREE_LAT * Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
    const metresNorth = stepLat * METRES_PER_DEGREE_LAT;

    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const here = scalar.data[index];
      if (!Number.isFinite(here)) {
        continue;
      }

      const east = column + 1 < columns ? scalar.data[index + 1] : NaN;
      const westward = column > 0 ? scalar.data[index - 1] : NaN;
      const north = row + 1 < rows ? scalar.data[index + columns] : NaN;
      const southward = row > 0 ? scalar.data[index - columns] : NaN;

      const alongLon = slopeAt(here, westward, east, metresEast);
      const alongLat = slopeAt(here, southward, north, metresNorth);
      if (alongLon === null || alongLat === null) {
        continue;
      }

      const [u, v] = flowOf(alongLon, alongLat, direction);
      const k = 2 * index;
      data[k] = u;
      data[k + 1] = v;
    }
  }

  return { data, columns, rows, west, south, stepLon, stepLat };
}

/**
 * The gradient read as a flow.
 *
 * `downhill` is the fall line, which is what water does and what an elevation
 * field means. `uphill` is its mirror. `contours` turns it a quarter turn so
 * the flow runs along the level lines rather than across them, high ground on
 * its right — the geostrophic reading, and the only one that makes sense of
 * pressure or temperature, where air circles a high instead of pouring off it.
 */
function flowOf(
  alongLon: number,
  alongLat: number,
  direction: GradientDirection
): [number, number] {
  switch (direction) {
    case 'uphill':
      return [alongLon, alongLat];
    case 'contours':
      return [-alongLat, alongLon];
    default:
      return [-alongLon, -alongLat];
  }
}

/**
 * The slope at one node along one axis, in metres of rise per metre travelled.
 *
 * Central where both neighbours are there, one-sided against an edge or a hole,
 * and null where neither is: a lone sample has no slope, and answering zero
 * would draw dead-flat ground where there is no ground at all.
 */
function slopeAt(here: number, before: number, after: number, metres: number): number | null {
  const hasBefore = Number.isFinite(before);
  const hasAfter = Number.isFinite(after);

  if (hasBefore && hasAfter) {
    return (after - before) / (2 * metres);
  }
  if (hasAfter) {
    return (after - here) / metres;
  }
  if (hasBefore) {
    return (here - before) / metres;
  }
  return null;
}

/**
 * Blurs the field with a separable Gaussian, leaving holes alone.
 *
 * A 0.25° grid carries high-frequency detail the tracer cannot use: adjacent
 * cells disagree enough to make a particle jitter between them, and the line
 * comes out wobbly rather than flowing. Esri smooths for exactly this reason
 * before tracing.
 *
 * Two rules keep the masking intact. A cell that is itself a hole stays a hole —
 * otherwise the blur would fill the cordillera with borrowed wind and quietly
 * undo the masking. And holes contribute nothing to their neighbours' averages:
 * treating NaN as a value would grow the hole outwards by a ring on every pass
 * until the field disappeared, so the weights are renormalised over whatever
 * valid samples the kernel actually found.
 */
export function smoothWindField(field: WindField, radiusCells: number): WindField {
  const data = blurGrid(
    field.data,
    { columns: field.columns, rows: field.rows, channels: 2 },
    radiusCells
  );

  return data === field.data ? field : { ...field, data };
}

/** The shape of a gridded buffer: how wide, how tall, how many values per cell. */
interface GridShape {
  columns: number;
  rows: number;
  channels: number;
}

/**
 * The same blur, over a buffer of any number of channels per cell.
 *
 * Two channels is a velocity field; one is the scalar a gradient field is
 * derived from, which has to be blurred *before* the derivative rather than
 * after it — see `buildGradientField`.
 */
function blurGrid(data: Float32Array, grid: GridShape, radiusCells: number): Float32Array {
  if (radiusCells < 1) {
    return data;
  }

  const kernel = gaussianKernel(radiusCells);

  // Separable: a horizontal pass then a vertical one, which is O(2r) per cell
  // instead of O(r²) and indistinguishable at these radii.
  return blurAlong(blurAlong(data, grid, kernel, true), grid, kernel, false);
}

function gaussianKernel(radius: number): number[] {
  const sigma = radius / 2 || 1;
  const weights: number[] = [];
  for (let offset = -radius; offset <= radius; offset++) {
    weights.push(Math.exp(-(offset * offset) / (2 * sigma * sigma)));
  }
  return weights;
}

function blurAlong(
  values: Float32Array,
  grid: GridShape,
  kernel: number[],
  horizontal: boolean
): Float32Array {
  const { columns, rows, channels } = grid;
  const radius = (kernel.length - 1) / 2;
  const data = new Float32Array(values.length);
  const sums = new Float64Array(channels);

  const whole = (at: number): boolean => {
    for (let channel = 0; channel < channels; channel++) {
      if (!Number.isFinite(values[at + channel])) {
        return false;
      }
    }
    return true;
  };

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const centre = channels * (row * columns + column);

      // A hole stays a hole.
      if (!whole(centre)) {
        data.fill(NaN, centre, centre + channels);
        continue;
      }

      sums.fill(0);
      let weight = 0;

      for (let offset = -radius; offset <= radius; offset++) {
        const c = horizontal ? column + offset : column;
        const r = horizontal ? row : row + offset;
        if (c < 0 || r < 0 || c >= columns || r >= rows) {
          continue;
        }

        const k = channels * (r * columns + c);
        if (!whole(k)) {
          continue;
        }

        const w = kernel[offset + radius];
        for (let channel = 0; channel < channels; channel++) {
          sums[channel] += values[k + channel] * w;
        }
        weight += w;
      }

      for (let channel = 0; channel < channels; channel++) {
        data[centre + channel] = sums[channel] / weight;
      }
    }
  }

  return data;
}

/**
 * Which rows of the frame make up one field.
 *
 * A wind query normally returns every hour of the forecast, so the same cell
 * appears many times. Without picking a single timestep each cell would simply
 * be overwritten by whichever row came last — silently drawing an arbitrary
 * hour, which for a reversing wind means drawing the opposite of the truth.
 * The earliest is chosen because it is deterministic and matches the start of
 * the window the query asked for.
 */
export function earliestTimestepRows(frame: GridFrame, timeColumn?: string): number[] {
  const all = Array.from({ length: frame.length }, (_, i) => i);

  const timeField = timeColumn ? frame.fields.find((f) => f.name === timeColumn) : undefined;
  if (!timeField) {
    return all;
  }

  const times = all.map((i) => Number(timeField.values[i])).filter(Number.isFinite);
  if (times.length === 0) {
    return all;
  }

  const earliest = Math.min(...times);
  return all.filter((i) => Number(timeField.values[i]) === earliest);
}

/**
 * Wind speed and meteorological direction to `u,v` components.
 *
 * `direction` is the bearing the wind blows **from**, clockwise from north —
 * the convention Open-Meteo, GFS and INAMHI all use. Hence the negative signs:
 * a north wind (0°) travels southwards, so `v` is negative. Reading it as the
 * bearing the wind blows *towards* mirrors and rotates the whole field, which
 * shows up as a vortex that looks like a source or a sink.
 */
export function speedDirToUV(speed: number, directionFromDegrees: number): [number, number] {
  const theta = (directionFromDegrees * Math.PI) / 180;
  return [-speed * Math.sin(theta), -speed * Math.cos(theta)];
}

/**
 * The regular lattice one axis sits on, or null if it does not sit on one.
 *
 * The spacing is the *smallest* gap between consecutive values, not the first,
 * so a grid keeps its true step when whole rows or columns are missing — which
 * is the normal case once cells are masked out. Every value then has to land on
 * that lattice.
 *
 * That last check is what separates a field from a scattering of points. A
 * handful of weather stations has gaps of no particular size; inferring a grid
 * from them yields a step invented from whichever pair happened to be closest,
 * with every other row landing between cells. The map then draws almost nothing
 * and gives no hint why. Refusing lets the caller fall back to drawing them as
 * the points they are.
 */
function axisOf(values: number[]): { min: number; step: number; count: number } | null {
  const distinct = [...new Set(values.map(Number))].sort((a, b) => a - b);
  if (distinct.length < 2) {
    return null;
  }

  let step = Infinity;
  for (let i = 1; i < distinct.length; i++) {
    step = Math.min(step, distinct[i] - distinct[i - 1]);
  }
  if (!(step > 0)) {
    return null;
  }

  const span = distinct[distinct.length - 1] - distinct[0];
  const count = Math.round(span / step) + 1;

  // A step that is tiny next to the span means the values are scattered, not
  // spaced; the lattice it implies would be enormous and almost entirely empty.
  if (count > 10_000) {
    return null;
  }

  const tolerance = step * 0.05;
  for (const value of distinct) {
    const offset = (value - distinct[0]) / step;
    if (Math.abs(offset - Math.round(offset)) * step > tolerance) {
      return null;
    }
  }

  return { min: distinct[0], step, count };
}

/**
 * The velocity at an arbitrary point, bilinearly interpolated.
 *
 * Nearest-cell sampling would make a particle jump between cells and the traced
 * lines come out as staircases — at 0.25° a cell is ~28 km wide, so the artefact
 * is very visible.
 */
export function sampleWindField(field: WindField, lon: number, lat: number): [number, number] | null {
  const fx = (lon - field.west) / field.stepLon;
  const fy = (lat - field.south) / field.stepLat;

  // Outside the domain there is no data to interpolate. Returning null rather
  // than clamping is what lets the tracer end a streamline at the edge instead
  // of smearing the boundary values outwards.
  if (fx < 0 || fy < 0 || fx > field.columns - 1 || fy > field.rows - 1) {
    return null;
  }

  // Clamp to the last full cell so a point exactly on the north or east edge
  // still interpolates instead of reading past the end of the buffer.
  const i = Math.min(Math.floor(fx), field.columns - 2);
  const j = Math.min(Math.floor(fy), field.rows - 2);
  const tx = fx - i;
  const ty = fy - j;

  const at = (column: number, row: number): [number, number] => {
    const k = 2 * (row * field.columns + column);
    return [field.data[k], field.data[k + 1]];
  };

  const [u00, v00] = at(i, j);
  const [u10, v10] = at(i + 1, j);
  const [u01, v01] = at(i, j + 1);
  const [u11, v11] = at(i + 1, j + 1);

  // A hole in any corner poisons the whole cell. Real fields have holes: over
  // Ecuador the 850 hPa surface is underground across the cordillera, so those
  // cells carry no wind. NaN would propagate silently — it fails every
  // comparison, including the tracer's speed check — so refuse instead.
  if (![u00, v00, u10, v10, u01, v01, u11, v11].every(Number.isFinite)) {
    return null;
  }

  return [
    lerp(lerp(u00, u10, tx), lerp(u01, u11, tx), ty),
    lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
