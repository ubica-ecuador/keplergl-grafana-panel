import { DataFrame } from '@grafana/data';

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
   * Only the earliest is used — see `rowsToUse`.
   */
  time?: string;
}

export function buildWindField(frame: DataFrame, columns: WindFieldColumns): WindField | null {
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

  const indices = rowsToUse(frame, columns.time);

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
  if (radiusCells < 1) {
    return field;
  }

  const kernel = gaussianKernel(radiusCells);

  // Separable: a horizontal pass then a vertical one, which is O(2r) per cell
  // instead of O(r²) and indistinguishable at these radii.
  const horizontal = blurAlong(field, kernel, true);
  return blurAlong(horizontal, kernel, false);
}

function gaussianKernel(radius: number): number[] {
  const sigma = radius / 2 || 1;
  const weights: number[] = [];
  for (let offset = -radius; offset <= radius; offset++) {
    weights.push(Math.exp(-(offset * offset) / (2 * sigma * sigma)));
  }
  return weights;
}

function blurAlong(field: WindField, kernel: number[], horizontal: boolean): WindField {
  const radius = (kernel.length - 1) / 2;
  const data = new Float32Array(field.data.length);

  for (let row = 0; row < field.rows; row++) {
    for (let column = 0; column < field.columns; column++) {
      const centre = 2 * (row * field.columns + column);

      // A hole stays a hole.
      if (!Number.isFinite(field.data[centre]) || !Number.isFinite(field.data[centre + 1])) {
        data[centre] = NaN;
        data[centre + 1] = NaN;
        continue;
      }

      let sumU = 0;
      let sumV = 0;
      let weight = 0;

      for (let offset = -radius; offset <= radius; offset++) {
        const c = horizontal ? column + offset : column;
        const r = horizontal ? row : row + offset;
        if (c < 0 || r < 0 || c >= field.columns || r >= field.rows) {
          continue;
        }

        const k = 2 * (r * field.columns + c);
        const u = field.data[k];
        const v = field.data[k + 1];
        if (!Number.isFinite(u) || !Number.isFinite(v)) {
          continue;
        }

        const w = kernel[offset + radius];
        sumU += u * w;
        sumV += v * w;
        weight += w;
      }

      data[centre] = sumU / weight;
      data[centre + 1] = sumV / weight;
    }
  }

  return { ...field, data };
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
function rowsToUse(frame: DataFrame, timeColumn?: string): number[] {
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

/** The distinct, sorted values of one axis, and the spacing between them. */
function axisOf(values: number[]): { min: number; step: number; count: number } | null {
  const distinct = [...new Set(values.map(Number))].sort((a, b) => a - b);
  if (distinct.length < 2) {
    return null;
  }
  return { min: distinct[0], step: distinct[1] - distinct[0], count: distinct.length };
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
