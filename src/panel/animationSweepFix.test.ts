import { nextIncrementalWindow, sweepEnd } from './animationSweepFix';

const DAY = 24 * 60 * 60 * 1000;
const t = (iso: string) => Date.parse(iso);

/** The rainfall calendar the defect was found on: seven daily scenes. */
const DOMAIN = [t('2026-08-20T00:00:00Z'), t('2026-08-26T00:00:00Z')];
/** kepler hands the controller the bin thresholds with the last one popped. */
const STEPS = Array.from({ length: 7 }, (_, i) => DOMAIN[0] + i * DAY);

/** Plays a sweep to its end, returning every window it passes through. */
function sweep(from: number, steps: readonly number[] | null = STEPS) {
  const frames: Array<[number, number]> = [];
  let value: [number, number] = [from, from + 1];
  for (let i = 0; i < 5000; i++) {
    value = nextIncrementalWindow({ domain: DOMAIN, value, steps });
    frames.push(value);
    // The restart — the window collapsing back onto its anchor — ends the sweep.
    if (value[1] === value[0] + 1 && frames.length > 1) {
      break;
    }
  }
  return frames;
}

describe('sweepEnd', () => {
  it('runs to the end of the last bin, which is a bin past the last timestamp', () => {
    expect(sweepEnd(DOMAIN, STEPS)).toBe(t('2026-08-27T00:00:00Z'));
  });

  it('measures the last bin by its own width, so uneven calendars still land right', () => {
    const monthly = [t('2026-01-01T00:00:00Z'), t('2026-02-01T00:00:00Z'), t('2026-03-01T00:00:00Z')];
    // March is 31 days; February, the bin before it, is 28.
    expect(sweepEnd([monthly[0], monthly[2]], monthly)).toBe(t('2026-03-29T00:00:00Z'));
  });

  it('falls back to the domain end when the filter has no bins to go by', () => {
    expect(sweepEnd(DOMAIN, null)).toBe(DOMAIN[1]);
    expect(sweepEnd(DOMAIN, [DOMAIN[0]])).toBe(DOMAIN[1]);
  });
});

describe('nextIncrementalWindow', () => {
  it('reaches the end of the last bin instead of restarting short of the data', () => {
    const frames = sweep(DOMAIN[0]);
    const ends = frames.map((f) => f[1]);
    // The frame before the restart is the far end of the histogram.
    expect(ends[ends.length - 2]).toBe(t('2026-08-27T00:00:00Z'));
  });

  it('keeps the last scene on screen as long as any other', () => {
    const frames = sweep(DOMAIN[0]);
    // A scene is current while the window end is past its timestamp and before
    // the next one — the panel's `pickLatestWithin` rule.
    const framesShowing = (scene: number) =>
      frames.filter((f) => f[1] >= scene && f[1] < scene + DAY).length;

    const lastScene = DOMAIN[1];
    const previousScene = DOMAIN[1] - DAY;
    expect(framesShowing(lastScene)).toBeGreaterThan(0);
    expect(framesShowing(lastScene)).toBe(framesShowing(previousScene));
  });

  it('never overshoots the end of the histogram', () => {
    const ends = sweep(DOMAIN[0]).map((f) => f[1]);
    expect(Math.max(...ends)).toBe(t('2026-08-27T00:00:00Z'));
  });

  it('restarts from the anchor once the sweep is done, and never moves it', () => {
    const anchor = t('2026-08-23T06:00:00Z');
    const frames = sweep(anchor);

    expect(frames.every((f) => f[0] === anchor)).toBe(true);
    expect(frames[frames.length - 1]).toEqual([anchor, anchor + 1]);
  });

  it('still ends on the data when the filter has no bins, rather than short of it', () => {
    const ends = sweep(DOMAIN[0], null).map((f) => f[1]);
    expect(Math.max(...ends)).toBe(DOMAIN[1]);
  });

  it('finishes rather than stalling on a domain with no width', () => {
    const flat = [DOMAIN[0], DOMAIN[0]];
    expect(nextIncrementalWindow({ domain: flat, value: [flat[0], flat[0]], steps: null })).toEqual([
      flat[0],
      flat[0] + 1,
    ]);
  });

  it('takes the same number of steps as kepler for the part of the sweep it shares', () => {
    // kepler's own increment: the domain crossed in `baseSpeed` frames.
    const delta = (DOMAIN[1] - DOMAIN[0]) / 600;
    const [, end] = nextIncrementalWindow({ domain: DOMAIN, value: [DOMAIN[0], DOMAIN[0] + 1], steps: STEPS });
    expect(end).toBe(DOMAIN[0] + 1 + delta);
  });
});
