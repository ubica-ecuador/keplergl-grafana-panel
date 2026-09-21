import { foldSavedSplitMaps, foldSurplusPanes, RENDERED_PANES } from './splitMapsNormalise';

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

/** A config as `parseSavedConfig` returns it, reduced to what the fold reads. */
function config(splitMaps: unknown[]) {
  return {
    visState: { splitMaps, layers: [{ id: 'boxoutline' }] },
    mapState: { isSplit: true },
  };
}

describe('foldSavedSplitMaps', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('returns the very same config when it has no more panes than kepler draws, and says nothing', () => {
    const two = config([pane('a'), pane('b')]);
    expect(foldSavedSplitMaps(two)).toBe(two);
    const unsplit = config([]);
    expect(foldSavedSplitMaps(unsplit)).toBe(unsplit);
    expect(warn).not.toHaveBeenCalled();
  });

  // What a Save during the doubling wrote: the appended panes are copies of the
  // kept ones. Folding them loses nothing, so it says nothing.
  it('stays silent when the dropped panes only repeat the kept ones', () => {
    const copy = { layers: { boxoutline: true } };
    foldSavedSplitMaps(config([copy, copy, copy, copy]));
    foldSavedSplitMaps(config([pane('a'), pane('b'), { layers: {} }, pane('a')]));
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once when a dropped pane held an assignment no kept pane has, naming the count', () => {
    const next = foldSavedSplitMaps(
      config([{ layers: { a: true, b: false } }, { layers: { a: false, b: true } }, { layers: { a: true, b: true } }])
    );
    expect(next.visState.splitMaps).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('has 3 panes');
    expect(warn.mock.calls[0][0]).toContain('1 were dropped, 1 of them');
  });

  it('is a no-op for a config without a vis state, and for no config at all', () => {
    const bare = { mapState: {} };
    expect(foldSavedSplitMaps(bare)).toBe(bare);
    expect(foldSavedSplitMaps(null)).toBeNull();
  });

  it('folds the pane list and leaves the rest of the config untouched', () => {
    const saved = config([pane('a'), pane('b'), pane('c'), pane('d')]);
    const next = foldSavedSplitMaps(saved);
    expect(next).not.toBe(saved);
    expect(next.visState.splitMaps).toEqual([pane('a'), pane('b')]);
    expect(next.visState.layers).toBe(saved.visState.layers);
    expect(next.mapState).toBe(saved.mapState);
  });

  it('is idempotent: folding what it just folded changes nothing, and warns no more', () => {
    const once = foldSavedSplitMaps(config([pane('a'), pane('b'), pane('c'), pane('d')]));
    warn.mockClear();
    expect(foldSavedSplitMaps(once)).toBe(once);
    expect(warn).not.toHaveBeenCalled();
  });
});
