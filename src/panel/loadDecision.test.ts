import { decideLoadAction, splitRasterRefresh, splitRefresh } from './loadDecision';

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

  it('refreshes once loaded when the config has not changed but the data has', () => {
    const config = { version: 'v1', config: {} };

    expect(
      decideLoadAction({
        hasLoaded: true,
        appliedConfig: config,
        currentConfig: config,
        appliedDatasets: [{ id: 'grafana-A' }],
        currentDatasets: [{ id: 'grafana-A' }],
      })
    ).toBe('refresh');
  });

  it('refreshes new data when no config is involved at all', () => {
    expect(
      decideLoadAction({
        hasLoaded: true,
        appliedConfig: undefined,
        currentConfig: undefined,
        appliedDatasets: [{ id: 'grafana-A' }],
        currentDatasets: [{ id: 'grafana-A' }],
      })
    ).toBe('refresh');
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

  it('does nothing when the same config arrives as a new object and the data has not moved', () => {
    // Grafana deep-clones the panel options on EVERY options change, so any
    // click in the editor — including "Save current map configuration" itself —
    // hands the effect a JSON-identical copy of the saved config. Anything but
    // a no-op here is destructive: `replaceDataInMap` empties the kepler store
    // and restores it through async tasks, so the save effect running in the
    // same commit snapshots the emptied store ({layers: [], filters: []}) and
    // the overlapping second replace loses the configured layers for good.
    const applied = { version: 'v1', config: { mapState: { zoom: 16 } } };
    const current = { version: 'v1', config: { mapState: { zoom: 16 } } };
    const datasets = [{ id: 'grafana-A' }];

    expect(
      decideLoadAction({
        hasLoaded: true,
        appliedConfig: applied,
        currentConfig: current,
        appliedDatasets: datasets,
        currentDatasets: datasets,
      })
    ).toBe('none');
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

describe('splitRasterRefresh', () => {
  const scene = (id: string, metadataUrl: string) => ({ id, metadataUrl });

  it('adds a raster the map does not hold yet', () => {
    const { add, replace, keep, remove } = splitRasterRefresh([scene('grafana-A-raster', 'http://t/aug')], []);

    expect(add.map((r) => r.id)).toEqual(['grafana-A-raster']);
    expect(replace).toEqual([]);
    expect(keep).toEqual([]);
    expect(remove).toEqual([]);
  });

  it('replaces a raster whose scene changed', () => {
    const { replace, keep } = splitRasterRefresh(
      [scene('grafana-A-raster', 'http://t/jul')],
      [scene('grafana-A-raster', 'http://t/aug')]
    );

    expect(replace.map((r) => r.id)).toEqual(['grafana-A-raster']);
    expect(keep).toEqual([]);
  });

  it('keeps a raster the auto-refresh re-derived unchanged', () => {
    // The 30s auto-refresh re-runs the query and produces a fresh object for
    // the same scene. Comparing by identity would swap the dataset — and the
    // raster would blink every refresh for no reason at all.
    const { keep, replace, add } = splitRasterRefresh(
      [scene('grafana-A-raster', 'http://t/aug')],
      [scene('grafana-A-raster', 'http://t/aug')]
    );

    expect(keep.map((r) => r.id)).toEqual(['grafana-A-raster']);
    expect(replace).toEqual([]);
    expect(add).toEqual([]);
  });

  it('removes a raster the query no longer produces', () => {
    // A range with no cloud-free scene returns no rows. Leaving the previous
    // scene on the map would show imagery from outside the range as if it
    // belonged to it.
    const { remove } = splitRasterRefresh([], [scene('grafana-A-raster', 'http://t/aug')]);

    expect(remove).toEqual(['grafana-A-raster']);
  });

  it('leaves tilesets the user added by hand alone', () => {
    // Only ids the panel itself minted are the panel's to remove; a tileset
    // from kepler's Add Data belongs to the user.
    const { remove } = splitRasterRefresh([], [scene('pawlsg7ej', 'https://titiler.xyz/cog/stac?url=x')]);

    expect(remove).toEqual([]);
  });
});
