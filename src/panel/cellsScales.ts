import { scaleThreshold } from 'd3-scale';

/**
 * Colour classes spaced on a log or square-root axis, for counts and sums whose cells run from a few to thousands:
 * Quantize puts nearly every cell in the first class, Quantile hides how far apart the classes are. Each is a
 * threshold scale marked `scaleType = 'threshold'`, which kepler's legend reads as classes with their bounds.
 */
export const SPACED_SCALES = ['log', 'sqrt'] as const;
export type SpacedScale = (typeof SPACED_SCALES)[number];

export function isSpacedScale(type: unknown): type is SpacedScale {
  return (SPACED_SCALES as readonly unknown[]).includes(type);
}

/** Two significant digits, so a legend reads 23 to 65, not 22.87 to 65.13. */
function rounded(value: number): number {
  return Number(value.toPrecision(2));
}

/**
 * The `classes - 1` bounds between `min` and `max` spaced evenly on the scale's axis, rounded, strictly increasing.
 * A log axis needs a positive start: with min ≤ 0 it starts a thousandth of max up.
 */
export function spacedThresholds(type: SpacedScale, min: number, max: number, classes: number): number[] {
  if (!(classes > 1) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return [];
  }
  const to = type === 'log' ? Math.log : Math.sqrt;
  const from = type === 'log' ? Math.exp : (v: number) => v * v;
  const lo = type === 'log' ? (min > 0 ? min : max / 1000) : Math.max(0, min);
  if (max <= lo) {
    return [];
  }
  const a = to(lo);
  const b = to(max);
  const bounds: number[] = [];
  for (let i = 1; i < classes; i++) {
    const t = rounded(from(a + ((b - a) * i) / classes));
    if (t > (bounds[bounds.length - 1] ?? -Infinity) && t > min && t < max) {
      bounds.push(t);
    }
  }
  return bounds;
}

/** A threshold scale over `colours` with spaced bounds, as kepler's legend and the cells both read it. */
export function spacedScale<C>(type: SpacedScale, domain: number[], colours: C[]) {
  const min = domain[0];
  const max = domain[domain.length - 1];
  const bounds = spacedThresholds(type, min, max, colours.length);
  const scale = scaleThreshold<number, C>()
    .domain(bounds)
    .range(colours.slice(0, bounds.length + 1));
  (scale as unknown as { scaleType: string }).scaleType = 'threshold';
  return scale;
}
