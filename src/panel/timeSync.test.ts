import { TimeSyncGuard, findTimeFieldName, rangesEqual, readTimeFilterValue } from './timeSync';

describe('readTimeFilterValue', () => {
  it('reads the window of a timeRange filter', () => {
    const filters = [
      { type: 'range', value: [0, 1] },
      { type: 'timeRange', value: [1000, 2000] },
    ];
    expect(readTimeFilterValue(filters)).toEqual({ from: 1000, to: 2000 });
  });

  it('returns null when there is no time filter', () => {
    expect(readTimeFilterValue([{ type: 'range', value: [0, 1] }])).toBeNull();
    expect(readTimeFilterValue([])).toBeNull();
  });

  it('returns null when the value is not a numeric pair', () => {
    expect(readTimeFilterValue([{ type: 'timeRange', value: undefined }])).toBeNull();
    expect(readTimeFilterValue([{ type: 'timeRange', value: [1000] }])).toBeNull();
  });
});

describe('findTimeFieldName', () => {
  it('returns the name of the first timestamp field', () => {
    const fields = [
      { name: 'lat', type: 'real' },
      { name: 'recorded_at', type: 'timestamp' },
    ];
    expect(findTimeFieldName(fields)).toBe('recorded_at');
  });

  it('returns null when no field is a timestamp', () => {
    expect(findTimeFieldName([{ name: 'lat', type: 'real' }])).toBeNull();
  });
});

describe('rangesEqual', () => {
  it('compares by endpoints', () => {
    expect(rangesEqual({ from: 1, to: 2 }, { from: 1, to: 2 })).toBe(true);
    expect(rangesEqual({ from: 1, to: 2 }, { from: 1, to: 3 })).toBe(false);
  });

  it('treats two nulls as equal and null vs range as different', () => {
    expect(rangesEqual(null, null)).toBe(true);
    expect(rangesEqual(null, { from: 1, to: 2 })).toBe(false);
  });
});

describe('TimeSyncGuard', () => {
  it('accepts a first value as new', () => {
    const guard = new TimeSyncGuard();
    expect(guard.accept({ from: 1, to: 2 })).toBe(true);
  });

  it('rejects the same value coming straight back — the echo', () => {
    const guard = new TimeSyncGuard();
    guard.accept({ from: 1, to: 2 });
    expect(guard.accept({ from: 1, to: 2 })).toBe(false);
  });

  it('separates the check from the commit so a failed push can retry', () => {
    const guard = new TimeSyncGuard();

    // A push is attempted but fails (no dataset yet): we check but do not commit.
    expect(guard.isNew({ from: 1, to: 2 })).toBe(true);
    // Still new on the next attempt, because the failed push never committed.
    expect(guard.isNew({ from: 1, to: 2 })).toBe(true);

    // The retry succeeds, so we commit — now it is no longer new.
    guard.commit({ from: 1, to: 2 });
    expect(guard.isNew({ from: 1, to: 2 })).toBe(false);
  });

  it('cuts the loop: a pushed value echoed back is not propagated onward', () => {
    // Model one shared guard across both directions.
    const guard = new TimeSyncGuard();

    // Grafana moves the window -> push to the map.
    expect(guard.accept({ from: 100, to: 200 })).toBe(true);
    // The map echoes that exact window back -> must not emit to Grafana.
    expect(guard.accept({ from: 100, to: 200 })).toBe(false);

    // The user now drags the map to a new window -> emit to Grafana.
    expect(guard.accept({ from: 300, to: 400 })).toBe(true);
    // Grafana echoes it back as a prop change -> must not push to the map.
    expect(guard.accept({ from: 300, to: 400 })).toBe(false);
  });
});
