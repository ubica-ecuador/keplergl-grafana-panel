import { playheadPhase, playheadWrite } from './playheadVariableSync';

describe('playheadWrite', () => {
  it('formats the instant as UTC ISO 8601', () => {
    expect(playheadWrite(Date.UTC(2026, 0, 1, 0, 14), null)).toBe('2026-01-01T00:14:00.000Z');
  });

  it('writes nothing when the text would repeat the last write', () => {
    const last = playheadWrite(1_767_226_440_000, null);
    expect(playheadWrite(1_767_226_440_000, last)).toBeNull();
    // kepler recomputes the same instant with a fraction of a millisecond: same text, same silence.
    expect(playheadWrite(1_767_226_440_000.2, last)).toBeNull();
  });

  it('writes when the instant moved', () => {
    const last = playheadWrite(1_767_226_440_000, null);
    expect(playheadWrite(1_767_226_441_000, last)).toBe('2026-01-01T00:14:01.000Z');
  });

  it('writes nothing for an instant that is not a number', () => {
    expect(playheadWrite(Number.NaN, null)).toBeNull();
    expect(playheadWrite(Number.POSITIVE_INFINITY, null)).toBeNull();
  });
});

describe('playheadPhase', () => {
  it('is playing while the clock runs', () => {
    expect(playheadPhase(true, false)).toBe('playing');
    expect(playheadPhase(true, true)).toBe('playing');
  });

  it('is stopped on the notification where the clock stops', () => {
    expect(playheadPhase(false, true)).toBe('stopped');
  });

  it('is idle when the clock was already still', () => {
    expect(playheadPhase(false, false)).toBe('idle');
  });
});
