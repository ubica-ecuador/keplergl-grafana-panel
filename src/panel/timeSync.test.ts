import {
  TimeSyncGuard,
  couplesDashboardRange,
  findTimeFieldName,
  rangesEqual,
  readTimeFilterDomain,
  readTimeFilterValue,
} from './timeSync';

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

describe('couplesDashboardRange', () => {
  it('couples the dashboard range in the two modes that drive the filter from it', () => {
    expect(couplesDashboardRange('toMap')).toBe(true);
    expect(couplesDashboardRange('bidirectional')).toBe(true);
  });

  it('leaves the dashboard range alone in variable mode, so the brush starts on the whole domain', () => {
    expect(couplesDashboardRange('variables')).toBe(false);
  });

  it('leaves it alone when sync is off', () => {
    expect(couplesDashboardRange('off')).toBe(false);
  });
});

describe('readTimeFilterDomain', () => {
  it("reads the data's full time extent, not the brushed window", () => {
    const filters = [{ type: 'timeRange', value: [1200, 1400], domain: [1000, 2000] }];
    expect(readTimeFilterDomain(filters)).toEqual({ from: 1000, to: 2000 });
  });

  it('returns null when there is no time filter', () => {
    expect(readTimeFilterDomain([{ type: 'range', value: [0, 1], domain: [0, 5] }])).toBeNull();
    expect(readTimeFilterDomain([])).toBeNull();
  });

  it('returns null when kepler has not computed the domain yet', () => {
    expect(readTimeFilterDomain([{ type: 'timeRange', value: [1, 2] }])).toBeNull();
    expect(readTimeFilterDomain([{ type: 'timeRange', value: [1, 2], domain: null }])).toBeNull();
    expect(readTimeFilterDomain([{ type: 'timeRange', value: [1, 2], domain: [1000] }])).toBeNull();
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
  /** The data's extent, steady unless a test says otherwise. */
  const DOMAIN = { from: 0, to: 10_000 };
  /** A dashboard range wider than the data — the ordinary case. */
  const DASHBOARD = { from: -50_000, to: 50_000 };

  /** Settles the guard on a freshly loaded map: pushed, clamped, domain seen. */
  function loaded(settled = DOMAIN) {
    const guard = new TimeSyncGuard();
    guard.recordPush(DASHBOARD, settled);
    // The first sight of a domain is a change, so it is adopted, not reported.
    guard.takeEmit(settled, DOMAIN, DASHBOARD);
    return guard;
  }

  it('pushes a dashboard range once, and not again while it stays put', () => {
    const guard = new TimeSyncGuard();
    expect(guard.shouldPush(DASHBOARD)).toBe(true);
    guard.recordPush(DASHBOARD, DOMAIN);
    expect(guard.shouldPush(DASHBOARD)).toBe(false);
    expect(guard.shouldPush({ from: 1, to: 2 })).toBe(true);
  });

  it('leaves a failed push pending, so it retries once the data lands', () => {
    const guard = new TimeSyncGuard();
    // The push found no time column to bind to, so nothing was recorded.
    expect(guard.shouldPush(DASHBOARD)).toBe(true);
    expect(guard.shouldPush(DASHBOARD)).toBe(true);
  });

  it("does not report kepler's clamp as a drag, so the dashboard keeps its range", () => {
    const guard = new TimeSyncGuard();
    // The dashboard asks for a wide window; the data only spans part of it, so
    // kepler settles on the narrower one.
    guard.recordPush(DASHBOARD, DOMAIN);
    expect(guard.takeEmit(DOMAIN, DOMAIN, DASHBOARD)).toBeNull();
    expect(guard.takeEmit(DOMAIN, DOMAIN, DASHBOARD)).toBeNull();
  });

  it('reports a window the user dragged', () => {
    const guard = loaded();
    expect(guard.takeEmit({ from: 2_000, to: 3_000 }, DOMAIN, DASHBOARD)).toEqual({ from: 2_000, to: 3_000 });
  });

  it('reports a dragged window once, not on every pass that follows', () => {
    const guard = loaded();
    guard.takeEmit({ from: 2_000, to: 3_000 }, DOMAIN, DASHBOARD);
    expect(guard.takeEmit({ from: 2_000, to: 3_000 }, DOMAIN, DASHBOARD)).toBeNull();
  });

  it('does not push a reported window straight back at the map', () => {
    const guard = loaded();
    const dragged = { from: 2_000, to: 3_000 };
    expect(guard.takeEmit(dragged, DOMAIN, DASHBOARD)).toEqual(dragged);
    // Grafana now holds that window and hands it back as a prop.
    expect(guard.shouldPush(dragged)).toBe(false);
  });

  it('adopts a window re-clamped by new data rather than reporting it again', () => {
    const guard = loaded();
    const dragged = { from: 2_000, to: 3_000 };
    guard.takeEmit(dragged, DOMAIN, DASHBOARD);

    // The narrower range re-ran the query, so the data — and with it the
    // domain — shrank, and kepler clamped the window to what is left.
    const shrunk = { from: 2_100, to: 2_900 };
    expect(guard.takeEmit(shrunk, shrunk, DASHBOARD)).toBeNull();
    // The clamped window is the new baseline, so it stays quiet.
    expect(guard.takeEmit(shrunk, shrunk, DASHBOARD)).toBeNull();
  });

  it('reports nothing when the map has no time filter at all', () => {
    expect(new TimeSyncGuard().takeEmit(null, null, DASHBOARD)).toBeNull();
  });

  it('does not push the stale dashboard range back while the drag is in flight', () => {
    const guard = loaded();
    const dragged = { from: 2_000, to: 3_000 };
    expect(guard.takeEmit(dragged, DOMAIN, DASHBOARD)).toEqual(dragged);
    // Grafana has been told, but its prop still reads the old window. Pushing
    // that now would snap the brush back out from under the user.
    expect(guard.shouldPush(DASHBOARD)).toBe(false);
    expect(guard.shouldPush(DASHBOARD)).toBe(false);
  });

  it('has nothing left to push once the dashboard prop catches up', () => {
    const guard = loaded();
    const dragged = { from: 2_000, to: 3_000 };
    guard.takeEmit(dragged, DOMAIN, DASHBOARD);
    expect(guard.shouldPush(dragged)).toBe(false);
  });

  it('still lets the user move the time picker while a drag is in flight', () => {
    const guard = loaded();
    guard.takeEmit({ from: 2_000, to: 3_000 }, DOMAIN, DASHBOARD);
    // Not the stale window and not the dragged one: the user reached for the
    // time picker, and that must not be swallowed.
    expect(guard.shouldPush({ from: 7, to: 8 })).toBe(true);
  });
});
