/**
 * A wind barb, worked out from a speed.
 *
 * The WMO convention: a pennant for every fifty knots, a full barb for every
 * ten, a half barb for five, and a circle for calm. Barbs count in knots and in
 * nothing else, so the speed is converted from whatever unit the query gave.
 */

export type SpeedUnit = 'm/s' | 'km/h' | 'kn' | 'ft/s' | 'mph';

/** The units Esri's VectorFieldRenderer accepts, in the order the panel offers them. */
export const SPEED_UNITS: SpeedUnit[] = ['m/s', 'km/h', 'kn', 'ft/s', 'mph'];

const KNOTS_PER_UNIT: Record<SpeedUnit, number> = {
  'm/s': 1.943844,
  'km/h': 0.539957,
  kn: 1,
  'ft/s': 0.592484,
  mph: 0.868976,
};

export function toKnots(speed: number, unit: SpeedUnit): number {
  return speed * (KNOTS_PER_UNIT[unit] ?? KNOTS_PER_UNIT['m/s']);
}

/**
 * The fastest barb the atlas carries. Four pennants is already a hurricane's
 * core; beyond it the symbol stops being readable long before the wind stops
 * being real, so faster winds draw as this one.
 */
export const MAX_BARB_KNOTS = 200;

export interface BarbParts {
  /** The speed drawn, rounded to five knots; 0 for calm. */
  knots: number;
  calm: boolean;
  pennants: number;
  full: number;
  half: boolean;
}

export function barbParts(knots: number): BarbParts {
  const clamped = Math.min(MAX_BARB_KNOTS, Math.max(0, knots));
  // Below half of the smallest barb there is nothing to draw but calm.
  if (clamped < 2.5) {
    return { knots: 0, calm: true, pennants: 0, full: 0, half: false };
  }
  const rounded = Math.round(clamped / 5) * 5;
  const pennants = Math.floor(rounded / 50);
  const full = Math.floor((rounded - pennants * 50) / 10);
  const half = rounded - pennants * 50 - full * 10 === 5;
  return { knots: rounded, calm: false, pennants, full, half };
}

/**
 * The atlas key of a barb.
 *
 * The hemisphere is part of it because the barbs change side at the equator —
 * see `vectorFieldGlyphs.ts` — and a field over Ecuador has symbols on both.
 */
export function barbIconKey(parts: BarbParts, southern: boolean): string {
  return parts.calm ? 'calm' : `barb-${parts.knots}-${southern ? 's' : 'n'}`;
}
