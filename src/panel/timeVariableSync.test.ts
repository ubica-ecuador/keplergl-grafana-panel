import {
  decideTimeSync,
  formatTimeValue,
  nextPublishDelay,
  parseTimeValue,
  readWindowFromVariables,
  timeVariableWrites,
  windowKey,
} from './timeVariableSync';

const mapping = { from: 'mapFrom', to: 'mapTo' };

describe('formatTimeValue', () => {
  it('writes epoch milliseconds as UTC ISO 8601', () => {
    expect(formatTimeValue(1682587140000)).toBe('2023-04-27T09:19:00.000Z');
  });

  it('keeps millisecond precision', () => {
    expect(formatTimeValue(1682587140123)).toBe('2023-04-27T09:19:00.123Z');
  });
});

describe('parseTimeValue', () => {
  it('reads back what formatTimeValue wrote', () => {
    expect(parseTimeValue(formatTimeValue(1682587140123))).toBe(1682587140123);
  });

  it('accepts an ISO string with a zone offset', () => {
    expect(parseTimeValue('2023-04-27T04:19:00.000-05:00')).toBe(1682587140000);
  });

  it('accepts epoch milliseconds as a number or a numeric string', () => {
    expect(parseTimeValue(1682587140000)).toBe(1682587140000);
    expect(parseTimeValue('1682587140000')).toBe(1682587140000);
  });

  it('rejects the empty, absent and All forms', () => {
    expect(parseTimeValue('')).toBeNull();
    expect(parseTimeValue(undefined)).toBeNull();
    expect(parseTimeValue(null)).toBeNull();
    expect(parseTimeValue('$__all')).toBeNull();
  });

  it('rejects a string that is not a time at all', () => {
    expect(parseTimeValue('not-a-date')).toBeNull();
  });

  it('takes the first entry when Grafana repeats the variable in the URL', () => {
    expect(parseTimeValue(['2023-04-27T09:19:00.000Z', 'ignored'])).toBe(1682587140000);
  });
});

describe('readWindowFromVariables', () => {
  it('reads the window both variables describe', () => {
    const values = { mapFrom: '2023-04-27T09:19:00.000Z', mapTo: '2023-04-30T10:52:00.000Z' };
    expect(readWindowFromVariables(values, mapping)).toEqual({ from: 1682587140000, to: 1682851920000 });
  });

  it('is null when either end is missing', () => {
    expect(readWindowFromVariables({ mapFrom: '2023-04-27T09:19:00.000Z' }, mapping)).toBeNull();
    expect(readWindowFromVariables({ mapTo: '2023-04-30T10:52:00.000Z' }, mapping)).toBeNull();
    expect(readWindowFromVariables({}, mapping)).toBeNull();
  });

  it('is null for an inverted window rather than filtering everything away', () => {
    const values = { mapFrom: '2023-04-30T10:52:00.000Z', mapTo: '2023-04-27T09:19:00.000Z' };
    expect(readWindowFromVariables(values, mapping)).toBeNull();
  });

  it('is null when the mapping names no variables', () => {
    const values = { mapFrom: '2023-04-27T09:19:00.000Z', mapTo: '2023-04-30T10:52:00.000Z' };
    expect(readWindowFromVariables(values, { from: '', to: '' })).toBeNull();
  });
});

describe('timeVariableWrites', () => {
  const window = { from: 1682587140000, to: 1682851920000 };
  const domain = { from: 1682000000000, to: 1683000000000 };

  it('writes the filter window to the mapped variables', () => {
    expect(timeVariableWrites(window, domain, mapping)).toEqual({
      mapFrom: '2023-04-27T09:19:00.000Z',
      mapTo: '2023-04-30T10:52:00.000Z',
    });
  });

  it('falls back to the data domain when the map has no time filter yet', () => {
    expect(timeVariableWrites(null, domain, mapping)).toEqual({
      mapFrom: formatTimeValue(domain.from),
      mapTo: formatTimeValue(domain.to),
    });
  });

  it('writes nothing when there is neither a window nor a domain', () => {
    expect(timeVariableWrites(null, null, mapping)).toEqual({});
  });

  it('skips an end whose variable is not configured', () => {
    expect(timeVariableWrites(window, domain, { from: 'mapFrom', to: '' })).toEqual({
      mapFrom: '2023-04-27T09:19:00.000Z',
    });
  });
});

describe('decideTimeSync', () => {
  const NONE = windowKey(null);
  const A = windowKey({ from: 1000, to: 2000 });
  const B = windowKey({ from: 1500, to: 2000 });

  it('does nothing when both sides already agree', () => {
    expect(decideTimeSync(A, A, undefined)).toBe('none');
    expect(decideTimeSync(A, A, A)).toBe('none');
  });

  it('lets preset variables drive the map on the first pass, so a shared link restores the brush', () => {
    expect(decideTimeSync(A, B, undefined)).toBe('toMap');
  });

  it('publishes the map window on the first pass when the variables are unset', () => {
    expect(decideTimeSync(A, NONE, undefined)).toBe('toVariables');
  });

  it('lets the variable drive once the map has not moved since the last sync', () => {
    expect(decideTimeSync(A, B, A)).toBe('toMap');
  });

  it('publishes to the variables when the map is what moved', () => {
    expect(decideTimeSync(B, A, A)).toBe('toVariables');
  });

  it('gives the map the tie when both sides moved', () => {
    expect(decideTimeSync(B, NONE, A)).toBe('toVariables');
  });
});

describe('windowKey', () => {
  it('gives equal windows the same key', () => {
    expect(windowKey({ from: 1, to: 2 })).toBe(windowKey({ from: 1, to: 2 }));
  });

  it('distinguishes different windows, and both from none', () => {
    expect(windowKey({ from: 1, to: 2 })).not.toBe(windowKey({ from: 1, to: 3 }));
    expect(windowKey({ from: 1, to: 2 })).not.toBe(windowKey(null));
  });

  it('ignores sub-millisecond noise so a clamped echo compares equal', () => {
    expect(windowKey({ from: 1.4, to: 2.6 })).toBe(windowKey({ from: 1, to: 3 }));
  });
});

describe('nextPublishDelay', () => {
  const REST = 300;
  const MAX = 1500;

  it('waits the full rest delay for a change that has just arrived', () => {
    expect(nextPublishDelay(1000, 1000, REST, MAX)).toBe(REST);
  });

  it('keeps waiting the rest delay while the cap is still far off, so a drag collapses into one write', () => {
    expect(nextPublishDelay(1200, 1000, REST, MAX)).toBe(REST);
  });

  it('shortens the wait so the cap is not overshot', () => {
    expect(nextPublishDelay(2400, 1000, REST, MAX)).toBe(100);
  });

  it('publishes immediately once the cap is reached, which is what lets playback report as it runs', () => {
    expect(nextPublishDelay(2500, 1000, REST, MAX)).toBe(0);
  });

  it('never asks for a negative delay when the cap is already past', () => {
    expect(nextPublishDelay(9000, 1000, REST, MAX)).toBe(0);
  });

  it('is a plain trailing debounce without a cap, which is how a silent playback stays silent', () => {
    expect(nextPublishDelay(1000, 1000, REST, Number.POSITIVE_INFINITY)).toBe(REST);
    expect(nextPublishDelay(60_000, 1000, REST, Number.POSITIVE_INFINITY)).toBe(REST);
  });
});
