import { decideLoadAction, splitRefresh } from './loadDecision';

/**
 * The panel has to choose between two very different kepler calls on every
 * render, and getting it wrong is silent: `addDataToMap` builds the map and
 * frames the viewport around the data, while `updateVisData` only swaps the
 * rows underneath an existing map. Taking the update path on the very first
 * load leaves the map sitting at kepler's default viewport over San Francisco
 * with the data invisible somewhere off-screen.
 */
describe('decideLoadAction', () => {
  it('rebuilds on the first load, even with no saved config', () => {
    // The regression this pins: `undefined !== undefined` is false, so
    // comparing configs alone made the first load look like a refresh.
    expect(decideLoadAction({ hasLoaded: false, appliedConfig: undefined, currentConfig: undefined })).toBe('rebuild');
  });

  it('rebuilds on the first load with a saved config', () => {
    const config = { version: 'v1', config: {} };

    expect(decideLoadAction({ hasLoaded: false, appliedConfig: undefined, currentConfig: config })).toBe('rebuild');
  });

  it('refreshes once loaded and the config has not changed', () => {
    const config = { version: 'v1', config: {} };

    expect(decideLoadAction({ hasLoaded: true, appliedConfig: config, currentConfig: config })).toBe('refresh');
  });

  it('refreshes when no config is involved at all', () => {
    expect(decideLoadAction({ hasLoaded: true, appliedConfig: undefined, currentConfig: undefined })).toBe('refresh');
  });

  it('rebuilds when the user imports a different config', () => {
    expect(
      decideLoadAction({
        hasLoaded: true,
        appliedConfig: { version: 'v1', config: {} },
        currentConfig: { version: 'v1', config: { visState: {} } },
      })
    ).toBe('rebuild');
  });

  it('refreshes when the same config arrives as a new object', () => {
    // Grafana hands the panel a fresh options object on every options change,
    // so the saved config is a structurally equal but non-identical copy.
    // Comparing by identity made every options change — including the click on
    // "Save current map configuration" itself — rebuild the map, which threw
    // away the viewport the user had just set and re-saved the stored one.
    const applied = { version: 'v1', config: { mapState: { zoom: 16 } } };
    const current = { version: 'v1', config: { mapState: { zoom: 16 } } };

    expect(decideLoadAction({ hasLoaded: true, appliedConfig: applied, currentConfig: current })).toBe('refresh');
  });

  it('rebuilds when the same object arrives with a different viewport', () => {
    const applied = { version: 'v1', config: { mapState: { zoom: 16 } } };
    const current = { version: 'v1', config: { mapState: { zoom: 11 } } };

    expect(decideLoadAction({ hasLoaded: true, appliedConfig: applied, currentConfig: current })).toBe('rebuild');
  });

  it('rebuilds when the user clears a saved config', () => {
    expect(
      decideLoadAction({ hasLoaded: true, appliedConfig: { version: 'v1', config: {} }, currentConfig: null })
    ).toBe('rebuild');
  });
});

/**
 * The bug this pins was silent and total: after the first load, every query
 * re-run left the map showing the data it already had. Verified in the browser
 * against the store — changing a dashboard variable re-ran the query, the
 * database returned a complete wind reversal (4.3 m/s from 250° against 2.9 m/s
 * from 70°), and kepler's dataset did not move a single row.
 */
describe('splitRefresh', () => {
  it('replaces the datasets kepler already holds', () => {
    const { replace, add } = splitRefresh([{ id: 'grafana-A' }, { id: 'grafana-B' }], ['grafana-A', 'grafana-B']);

    expect(replace.map((d) => d.id)).toEqual(['grafana-A', 'grafana-B']);
    expect(add).toEqual([]);
  });

  it('adds the ones it does not', () => {
    // A query gaining a refId is a new dataset, and `replaceDataInMap` has
    // nothing to replace — it needs an id that already exists.
    const { replace, add } = splitRefresh([{ id: 'grafana-A' }, { id: 'grafana-B' }], ['grafana-A']);

    expect(replace.map((d) => d.id)).toEqual(['grafana-A']);
    expect(add.map((d) => d.id)).toEqual(['grafana-B']);
  });

  it('sends everything down the add path on an empty map', () => {
    const { replace, add } = splitRefresh([{ id: 'grafana-A' }], []);

    expect(replace).toEqual([]);
    expect(add.map((d) => d.id)).toEqual(['grafana-A']);
  });
});
