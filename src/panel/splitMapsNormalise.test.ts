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
  it('returns the very same state object when nothing has grown', () => {
    const state = store([pane('a'), pane('b')]);
    expect(withFoldedSplitMaps(state)).toBe(state);
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

  it('is idempotent: folding what it just folded changes nothing', () => {
    const once = withFoldedSplitMaps(store([pane('a'), pane('b'), pane('c'), pane('d')]));
    expect(withFoldedSplitMaps(once)).toBe(once);
  });
});
