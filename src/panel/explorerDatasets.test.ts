import { registerEntry } from '@kepler.gl/actions';
import type { Store } from 'redux';

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
    expect(applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'add' })).toBe('explore-hot');
    await settle();
    expect(applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(2), mode: 'add' })).toBe('explore-hot-2');
    await settle();
    expect(readDatasetIds(store).sort()).toEqual(['explore-hot', 'explore-hot-2']);
    expect(rowsIn(store, 'explore-hot')).toBe(3);
    expect(rowsIn(store, 'explore-hot-2')).toBe(2);
  });

  it('keeps two same-tick adds of the same label apart, before kepler registers the first', async () => {
    const first = applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'add' });
    const second = applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(2), mode: 'add' });
    expect(first).toBe('explore-hot');
    expect(second).toBe('explore-hot-2');
    await settle();
    expect(readDatasetIds(store).sort()).toEqual(['explore-hot', 'explore-hot-2']);
    expect(rowsIn(store, 'explore-hot')).toBe(3);
    expect(rowsIn(store, 'explore-hot-2')).toBe(2);
  });

  it("replaces the rows of the label's dataset, and creates it when the map has none", async () => {
    applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'replace' });
    await settle();
    expect(rowsIn(store, 'explore-hot')).toBe(3);
    applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(5), mode: 'replace' });
    await settle();
    expect(readDatasetIds(store)).toEqual(['explore-hot']);
    expect(rowsIn(store, 'explore-hot')).toBe(5);
  });

  it("survives a refresh of the panel's own query datasets", async () => {
    const query: PanelDataset = { id: 'grafana-A', label: 'Query A', rows: points(4) };
    refreshDatasets(store, store.dispatch, [query]);
    applyExplorerDataset(store, store.dispatch, { label: 'Hot', rows: points(3), mode: 'add' });
    await settle();
    refreshDatasets(store, store.dispatch, [{ ...query, rows: points(6) }]);
    await settle();
    expect(readDatasetIds(store).sort()).toEqual(['explore-hot', 'grafana-A']);
    expect(rowsIn(store, 'explore-hot')).toBe(3);
    expect(rowsIn(store, 'grafana-A')).toBe(6);
  });
});
