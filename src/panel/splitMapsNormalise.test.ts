import { foldSurplusPanes, RENDERED_PANES, withFoldedSplitMaps } from './splitMapsNormalise';

const pane = (label: string) => ({ layers: { [label]: true } });

describe('foldSurplusPanes', () => {
  it('leaves a list kepler can draw exactly as it is, by identity', () => {
    const two = [pane('a'), pane('b')];
    expect(foldSurplusPanes(two)).toBe(two);
    const none: unknown[] = [];
    expect(foldSurplusPanes(none)).toBe(none);
  });

  it('keeps the first two panes and drops the appended copies', () => {
    const live = [pane('a'), pane('b')];
    const folded = foldSurplusPanes([...live, pane('copy-a'), pane('copy-b')]);
    expect(folded).toEqual(live);
    expect(folded).toHaveLength(RENDERED_PANES);
  });

  it('folds the doubling that was measured, whatever it has reached', () => {
    const grown = Array.from({ length: 512 }, (_, i) => pane(`p${i}`));
    expect(foldSurplusPanes(grown)).toEqual([pane('p0'), pane('p1')]);
  });
});

function store(splitMaps: unknown[]) {
  return {
    keplerGl: {
      grafana: { visState: { splitMaps, layers: [{ id: 'boxoutline' }] }, mapState: { isSplit: true } },
    },
  };
}

describe('withFoldedSplitMaps', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('returns the very same state object when nothing has grown, and says nothing', () => {
    const state = store([pane('a'), pane('b')]);
    expect(withFoldedSplitMaps(state)).toBe(state);
    expect(withFoldedSplitMaps(store([]))).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });

  // What the bench showed on every normal curtain load: the appended panes are
  // copies of the kept ones. Folding them loses nothing, so it says nothing.
  it('stays silent when the dropped panes only repeat the kept ones', () => {
    const copy = { layers: { boxoutline: true } };
    withFoldedSplitMaps(store([copy, copy, copy, copy]));
    withFoldedSplitMaps(store([pane('a'), pane('b'), { layers: {} }, pane('a')]));
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once when a dropped pane held an assignment no kept pane has, naming the count', () => {
    const next = withFoldedSplitMaps(
      store([{ layers: { a: true, b: false } }, { layers: { a: false, b: true } }, { layers: { a: true, b: true } }])
    );
    expect(next.keplerGl.grafana.visState.splitMaps).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('had 3 panes');
    expect(warn.mock.calls[0][0]).toContain('1 were dropped, 1 of them');
  });

  it('is a no-op before kepler has registered, and for a state that is not kepler', () => {
    const empty = {};
    expect(withFoldedSplitMaps(empty)).toBe(empty);
    expect(withFoldedSplitMaps(undefined)).toBeUndefined();
  });

  it('folds the pane list and leaves the rest of the instance untouched', () => {
    const state = store([pane('a'), pane('b'), pane('c'), pane('d')]);
    const next = withFoldedSplitMaps(state);
    expect(next).not.toBe(state);
    expect(next.keplerGl.grafana.visState.splitMaps).toEqual([pane('a'), pane('b')]);
    expect(next.keplerGl.grafana.visState.layers).toBe(state.keplerGl.grafana.visState.layers);
    expect(next.keplerGl.grafana.mapState).toBe(state.keplerGl.grafana.mapState);
  });

  it('is idempotent: folding what it just folded changes nothing, and warns no more', () => {
    const once = withFoldedSplitMaps(store([pane('a'), pane('b'), pane('c'), pane('d')]));
    warn.mockClear();
    expect(withFoldedSplitMaps(once)).toBe(once);
    expect(warn).not.toHaveBeenCalled();
  });
});
