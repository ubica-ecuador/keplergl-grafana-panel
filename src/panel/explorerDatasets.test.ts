import { registerEntry } from '@kepler.gl/actions';
import type { Dispatch, Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { applyExplorerDataset, explorerDatasetId } from './explorerDatasets';
import { readDatasetIds, refreshDatasets } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

jest.mock('@grafana/runtime', () => {
  const { EventBusSrv } = jest.requireActual('@grafana/data');
  return { getAppEvents: () => new EventBusSrv() };
});

/** kepler's data pipeline settles on the task middleware's promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const points = (n: number) => Array.from({ length: n }, (_, i) => ({ latitude: -2.9 + i * 0.001, longitude: -79, id: i }));
const rowsIn = (store: Store, id: string): number =>
  (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState.datasets[id].dataContainer.numRows();
const labelOf = (store: Store, id: string): string =>
  (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState.datasets[id].label;

/** A dispatch that simulates kepler refusing a dispatch: the action never reaches the store. */
const droppedDispatch = ((action: unknown) => action) as unknown as Dispatch;

let store: Store;
beforeEach(() => {
  store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
});

describe('explorerDatasetId', () => {
  it('slugs the label under the explore- prefix', () => {
    expect(explorerDatasetId('Hot spots > 20°')).toBe('explore-hot-spots-20');
    expect(explorerDatasetId('Ñandú')).toBe('explore-nandu');
    expect(explorerDatasetId('***')).toBe('explore-result');
  });
});

describe('applyExplorerDataset', () => {
  it('adds a dataset, and a second add of the same label beside it', async () => {
    expect(await applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'add' })).toBe(
      'explore-hot'
    );
    expect(await applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(2), mode: 'add' })).toBe(
      'explore-hot-2'
    );
    expect(readDatasetIds(store).sort()).toEqual(['explore-hot', 'explore-hot-2']);
    expect(rowsIn(store, 'explore-hot')).toBe(3);
    expect(rowsIn(store, 'explore-hot-2')).toBe(2);
  });

  it('keeps two same-tick adds of the same label apart, before kepler registers the first', async () => {
    const first = applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'add' });
    const second = applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(2), mode: 'add' });
    expect(await first).toBe('explore-hot');
    expect(await second).toBe('explore-hot-2');
    expect(readDatasetIds(store).sort()).toEqual(['explore-hot', 'explore-hot-2']);
    expect(rowsIn(store, 'explore-hot')).toBe(3);
    expect(rowsIn(store, 'explore-hot-2')).toBe(2);
  });

  it('keeps two same-tick replaces of the same label in order, not as two datasets', async () => {
    const first = applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'replace' });
    const second = applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(5), mode: 'replace' });
    await first;
    await second;
    expect(readDatasetIds(store)).toEqual(['explore-hot']);
    expect(rowsIn(store, 'explore-hot')).toBe(5);
  });

  it("replaces the rows of the label's dataset, and creates it when the map has none", async () => {
    await applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'replace' });
    expect(rowsIn(store, 'explore-hot')).toBe(3);
    await applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(5), mode: 'replace' });
    expect(readDatasetIds(store)).toEqual(['explore-hot']);
    expect(rowsIn(store, 'explore-hot')).toBe(5);
  });

  it('replaces by the exact label, so two labels with the same slug never overwrite each other', async () => {
    const replace = (label: string, n: number) =>
      applyExplorerDataset(store, store.dispatch, { label, rows: points(n), mode: 'replace' });
    expect(await replace('Hot spots', 3)).toBe('explore-hot-spots');
    expect(await replace('hot-spots', 2)).toBe('explore-hot-spots-2');
    expect(await replace('hot-spots', 5)).toBe('explore-hot-spots-2');
    expect(readDatasetIds(store).sort()).toEqual(['explore-hot-spots', 'explore-hot-spots-2']);
    expect(rowsIn(store, 'explore-hot-spots')).toBe(3);
    expect(labelOf(store, 'explore-hot-spots')).toBe('Hot spots');
    expect(rowsIn(store, 'explore-hot-spots-2')).toBe(5);
    expect(labelOf(store, 'explore-hot-spots-2')).toBe('hot-spots');

    expect(await replace('Hot spots', 7)).toBe('explore-hot-spots');
    expect(rowsIn(store, 'explore-hot-spots')).toBe(7);
    expect(rowsIn(store, 'explore-hot-spots-2')).toBe(5);
  });

  it('keeps apart labels that have no slug at all', async () => {
    const replace = (label: string, n: number) =>
      applyExplorerDataset(store, store.dispatch, { label, rows: points(n), mode: 'replace' });
    expect(await replace('東京', 3)).toBe('explore-result');
    expect(await replace('大阪', 2)).toBe('explore-result-2');
    expect(await replace('東京', 4)).toBe('explore-result');
    expect(rowsIn(store, 'explore-result')).toBe(4);
    expect(labelOf(store, 'explore-result')).toBe('東京');
    expect(rowsIn(store, 'explore-result-2')).toBe(2);
    expect(labelOf(store, 'explore-result-2')).toBe('大阪');
  });

  it("survives a refresh of the panel's own query datasets", async () => {
    const query: PanelDataset = { id: 'grafana-A', label: 'Query A', rows: points(4) };
    refreshDatasets(store, store.dispatch, [query]);
    await applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'add' });
    await settle();
    refreshDatasets(store, store.dispatch, [{ ...query, rows: points(6) }]);
    await settle();
    expect(readDatasetIds(store).sort()).toEqual(['explore-hot', 'grafana-A']);
    expect(rowsIn(store, 'explore-hot')).toBe(3);
    expect(rowsIn(store, 'grafana-A')).toBe(6);
  });

  it('gives up on a create kepler never takes, and lets a later add reuse the id', async () => {
    // droppedDispatch simulates kepler refusing the create outright: the
    // action never reaches the store, so kepler can never register the id.
    await expect(
      applyExplorerDataset(store, droppedDispatch, { label: 'Hot', rows: points(3), mode: 'add' }, 200)
    ).rejects.toThrow(/Hot/);

    const id = await applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(2), mode: 'add' });
    expect(id).toBe('explore-hot');
    expect(rowsIn(store, 'explore-hot')).toBe(2);
  });
});
