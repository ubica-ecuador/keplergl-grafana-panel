import { armFit, armsFit, decideFit, FIT_ARM_MAX_MS, FIT_GRACE_MS, variablesKey } from './fitOnVariables';

/**
 * The rules behind "the map frames its rows again when the state changes".
 *
 * A refresh never moves the viewport; a change of a named variable arms a fit,
 * which frames the rows once they are somewhere else than they were, and the
 * later steps of that change for a short grace, then lets the map go. Everything here runs against literal
 * values — no kepler, no store, no URL.
 */

const url = (values: Record<string, string | string[] | undefined>) => (name: string) => values[name];

describe('variablesKey', () => {
  it('changes when a named variable changes, and only then', () => {
    const il = variablesKey(['state'], url({ state: 'IL', grupo: 'Polish' }));
    expect(variablesKey(['state'], url({ state: 'IL', grupo: 'Mexican' }))).toBe(il);
    expect(variablesKey(['state'], url({ state: 'CA', grupo: 'Polish' }))).not.toBe(il);
  });

  it('tells a missing variable from an empty one, and reads multi-value lists', () => {
    expect(variablesKey(['v'], url({}))).not.toBe(variablesKey(['v'], url({ v: '' })));
    expect(variablesKey(['v'], url({ v: ['a', 'b'] }))).not.toBe(variablesKey(['v'], url({ v: ['a'] })));
  });
});

describe('armsFit', () => {
  it('never on the first reading: that is the dashboard loading, which frames on its own', () => {
    expect(armsFit(null, '[["state","IL"]]')).toBe(false);
  });

  it('on a change of value, not on a URL change that leaves the values alone', () => {
    expect(armsFit('[["state","IL"]]', '[["state","CA"]]')).toBe(true);
    expect(armsFit('[["state","IL"]]', '[["state","IL"]]')).toBe(false);
  });
});

describe('decideFit', () => {
  const RI = '[-71.86,41.15,-71.12,42.02]';
  const TX = '[-106.65,25.84,-93.51,36.5]';
  const armed = armFit(1_000, RI);

  it('does nothing while nothing is armed', () => {
    expect(decideFit(null, 5_000, TX)).toEqual({ fit: false, arm: null });
  });

  it('waits through refreshes with no rows — the join of new shapes and old values', () => {
    expect(decideFit(armed, 2_000, null)).toEqual({ fit: false, arm: armed });
  });

  it('frames the old rows once, in case the user panned away, and keeps waiting for the new ones', () => {
    const once = decideFit(armed, 1_100, RI);
    expect(once).toEqual({ fit: true, arm: { ...armed, fittedBounds: RI, movedAt: null } });
    expect(decideFit(once.arm, 1_200, RI)).toEqual({ fit: false, arm: once.arm });
    // The new rows land well after a grace would have ended: they are framed all the same.
    expect(decideFit(once.arm, 1_000 + 3 * FIT_GRACE_MS, TX)).toEqual({
      fit: true,
      arm: { ...armed, fittedBounds: TX, movedAt: 1_000 + 3 * FIT_GRACE_MS },
    });
  });

  it('frames the later steps of the same change while the grace lasts, and never the same extent twice', () => {
    const moved = { ...armed, fittedBounds: TX, movedAt: 3_000 };
    const wider = '[-107,25,-93,37]';
    expect(decideFit(moved, 3_000 + FIT_GRACE_MS, TX)).toEqual({ fit: false, arm: moved });
    expect(decideFit(moved, 3_000 + FIT_GRACE_MS, wider)).toEqual({
      fit: true,
      arm: { ...moved, fittedBounds: wider },
    });
  });

  it('lets the map go once the grace is over, so a later refresh never fights the user', () => {
    const moved = { ...armed, fittedBounds: TX, movedAt: 3_000 };
    expect(decideFit(moved, 3_001 + FIT_GRACE_MS, '[-100,30,-95,33]')).toEqual({ fit: false, arm: null });
  });

  it('gives up on a change whose rows never moved', () => {
    expect(decideFit(armed, 1_001 + FIT_ARM_MAX_MS, TX)).toEqual({ fit: false, arm: null });
  });
});
