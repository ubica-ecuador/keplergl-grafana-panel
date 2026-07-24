import { decideLoadAction } from './loadDecision';

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

  it('rebuilds when the user clears a saved config', () => {
    expect(
      decideLoadAction({ hasLoaded: true, appliedConfig: { version: 'v1', config: {} }, currentConfig: null })
    ).toBe('rebuild');
  });
});
