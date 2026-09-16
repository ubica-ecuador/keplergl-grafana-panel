import { receiveMapConfig, registerEntry, toggleSplitMap, wrapTo } from '@kepler.gl/actions';

import { KEPLER_INSTANCE_ID } from './constants';
import { createKeplerStore } from './keplerStore';

/**
 * The store the panel really builds, driven through kepler's real reducers.
 *
 * What it reproduces is the step that doubled the pane list on the bench: a
 * split whose panes are empty, merged with a config whose panes are empty too.
 * `mergeSplitMaps` takes its empty-entry branch (`merged.push`) and appends
 * instead of folding. On the bench the config came from
 * `prepareStateForDatasetReplace` copying the live panes during a refresh; here
 * it is handed straight to `receiveMapConfig`, which calls the same merger.
 *
 * Not through `addDataToMap` with a saved config: that path spins forever under
 * jest (see the memory note on kepler under jest), and the merge being tested
 * is the same function either way.
 */
function splitMapsOf(store: ReturnType<typeof createKeplerStore>): unknown[] {
  const state = store.getState() as { keplerGl: Record<string, { visState: { splitMaps: unknown[] } }> };
  return state.keplerGl[KEPLER_INSTANCE_ID].visState.splitMaps;
}

const EMPTY_PANES = { visState: { splitMaps: [{ layers: {} }, { layers: {} }] } };

describe('createKeplerStore', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('folds the pane list kepler grows back to the two it can draw', () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, toggleSplitMap(0)) as never);
    expect(splitMapsOf(store)).toHaveLength(2);
    // Registering and opening a split never trims anything.
    expect(warn).not.toHaveBeenCalled();

    // Each merge appends two more panes in kepler; the store must not keep them.
    for (let refresh = 0; refresh < 4; refresh++) {
      store.dispatch(
        wrapTo(KEPLER_INSTANCE_ID, receiveMapConfig(EMPTY_PANES as never, { keepExistingConfig: true })) as never
      );
      expect(splitMapsOf(store)).toHaveLength(2);
    }
    // Empty appended panes lose nothing, so the fold does its work silently.
    expect(warn).not.toHaveBeenCalled();
  });
});
