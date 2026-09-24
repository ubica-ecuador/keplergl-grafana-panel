import { renderHook } from '@testing-library/react';
import { AppEvents, BusEventWithPayload, EventBusSrv } from '@grafana/data';
import { registerEntry } from '@kepler.gl/actions';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import type { Store } from 'redux';

import { KEPLER_INSTANCE_ID } from './constants';
import { rowsFromTable } from '../data/explorerQuery';
import { applyExplorerDataset } from './explorerDatasets';
import { readDatasetIds } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { showExplorerResult, useExplorerDatasets } from './useExplorerDatasets';

const mockBus = new EventBusSrv();
jest.mock('@grafana/runtime', () => ({ getAppEvents: () => mockBus }));

// `applyExplorerDataset` is wrapped in a real jest.fn so it calls straight
// through to the actual implementation by default — every test but one below
// exercises the real thing — while the "kepler never takes it" test can still
// force one rejection with `mockRejectedValueOnce`. A plain `jest.spyOn` on
// the module namespace cannot redefine this export: `@swc/jest` compiles it
// to a non-configurable accessor.
jest.mock('./explorerDatasets', () => {
  const actual = jest.requireActual('./explorerDatasets');
  return { ...actual, applyExplorerDataset: jest.fn(actual.applyExplorerDataset) };
});
// The same for the conversion, so one test can make it throw.
jest.mock('../data/explorerQuery', () => {
  const actual = jest.requireActual('../data/explorerQuery');
  return { ...actual, rowsFromTable: jest.fn(actual.rowsFromTable) };
});

class ExplorerSideEvent extends BusEventWithPayload<unknown> {
  static type = 'ubica-explorer-to-map';
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const pointsIPC = (rows: number) => {
  const lat = Float64Array.from({ length: rows }, (_, i) => -2.9 + i * 0.001);
  return tableToIPC(tableFromArrays({ latitude: lat, longitude: lat.map(() => -79) }), 'stream');
};

const rowsIn = (store: Store, id: string): number =>
  (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState.datasets[id].dataContainer.numRows();

/** A window whose Chaski answers every query with `rows` points, or fails with `error`. */
function chaskiWindow(rows: number, error?: string) {
  const sent: string[] = [];
  const win = {
    __chaski: {
      apiVersion: 1,
      engine: async () => ({
        queryIPC: async (sql: string) => {
          sent.push(sql);
          if (error) {
            throw new Error(error);
          }
          return pointsIPC(rows);
        },
      }),
    },
  };
  return { win, sent };
}

// Grafana's alerts are legacy events, published as { type: name, payload }: listen on the name.
const alerts: Array<{ type: string; payload: unknown }> = [];
mockBus.subscribe({ type: AppEvents.alertWarning.name } as never, (e: any) =>
  alerts.push({ type: 'warning', payload: e.payload })
);
mockBus.subscribe({ type: AppEvents.alertError.name } as never, (e: any) =>
  alerts.push({ type: 'error', payload: e.payload })
);

let store: Store;
beforeEach(() => {
  alerts.length = 0;
  store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
});

describe('showExplorerResult', () => {
  it('queries through the wrapper and adds the rows', async () => {
    const { win, sent } = chaskiWindow(3);
    const id = await showExplorerResult(store, { sql: 'SELECT * FROM points', label: 'Pts', mode: 'add' }, win);
    await settle();
    expect(id).toBe('explore-pts');
    expect(sent).toEqual(['SELECT * FROM (\nSELECT * FROM points\n) LIMIT 200001']);
    expect(readDatasetIds(store)).toEqual(['explore-pts']);
    expect(alerts).toEqual([]);
  });

  it('warns when the result was cut at the cap', async () => {
    const { win } = chaskiWindow(200_001);
    await showExplorerResult(store, { sql: 'SELECT 1', label: 'Big', mode: 'add' }, win);
    expect(alerts).toEqual([{ type: 'warning', payload: [expect.stringContaining('200,000')] }]);
  }, 60_000);

  it('shows the error and leaves the map alone when the query fails', async () => {
    const { win } = chaskiWindow(0, 'Binder Error: column "nope" not found');
    expect(await showExplorerResult(store, { sql: 'SELECT nope', label: 'X', mode: 'add' }, win)).toBeNull();
    await settle();
    expect(readDatasetIds(store)).toEqual([]);
    expect(alerts).toEqual([{ type: 'error', payload: [expect.any(String), expect.stringContaining('nope')] }]);
  });

  it('does nothing, quietly for the user, without Chaski', async () => {
    expect(await showExplorerResult(store, { sql: 'SELECT 1', label: 'X', mode: 'add' }, {})).toBeNull();
    expect(readDatasetIds(store)).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it('does nothing for every reason there is no engine, not only its absence', async () => {
    const request = { sql: 'SELECT 1', label: 'X', mode: 'add' } as const;
    const windows = [
      {},
      { __chaski: { apiVersion: 2, engine: () => undefined } },
      { __chaski: { apiVersion: 1, engine: () => undefined } },
    ];
    for (const win of windows) {
      expect(await showExplorerResult(store, request, win)).toBeNull();
    }
    expect(readDatasetIds(store)).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it('shows an error and resolves null when kepler never takes the dataset', async () => {
    const { win } = chaskiWindow(3);
    const rejection = new Error('kepler never registered the explorer dataset "Pts" (id "explore-pts")');
    (applyExplorerDataset as jest.Mock).mockRejectedValueOnce(rejection);
    const id = await showExplorerResult(store, { sql: 'SELECT * FROM points', label: 'Pts', mode: 'add' }, win);
    await settle();
    expect(id).toBeNull();
    expect(alerts).toEqual([{ type: 'error', payload: ['Map: could not show "Pts"', rejection.message] }]);
  });

  it('shows an error and resolves null when the result cannot be turned into rows', async () => {
    const { win } = chaskiWindow(3);
    (rowsFromTable as jest.Mock).mockImplementationOnce(() => {
      throw new Error('unreadable column');
    });
    expect(await showExplorerResult(store, { sql: 'SELECT 1', label: 'Odd', mode: 'add' }, win)).toBeNull();
    await settle();
    expect(readDatasetIds(store)).toEqual([]);
    expect(alerts).toEqual([{ type: 'error', payload: ['Map: could not show "Odd"', 'unreadable column'] }]);
  });
});

describe('showExplorerResult on one map', () => {
  it('shows results in the order they were sent, even when the first query is the slow one', async () => {
    const steps: string[] = [];
    // `slow` answers 3 rows after 100 ms, `fast` 5 rows at once.
    const answers = { slow: { rows: 3, delayMs: 100 }, fast: { rows: 5, delayMs: 0 } };
    const win = {
      __chaski: {
        apiVersion: 1,
        engine: async () => ({
          queryIPC: async (sql: string) => {
            const name = sql.includes('slow') ? 'slow' : 'fast';
            steps.push(`start ${name}`);
            await new Promise((resolve) => setTimeout(resolve, answers[name].delayMs));
            steps.push(`end ${name}`);
            return pointsIPC(answers[name].rows);
          },
        }),
      },
    };
    const apply = applyExplorerDataset as jest.Mock;
    apply.mockClear();

    const first = showExplorerResult(store, { sql: 'SELECT * FROM slow', label: 'Hot', mode: 'replace' }, win);
    const second = showExplorerResult(store, { sql: 'SELECT * FROM fast', label: 'Hot', mode: 'replace' }, win);
    expect(await first).toBe('explore-hot');
    expect(await second).toBe('explore-hot');

    expect(steps).toEqual(['start slow', 'end slow', 'start fast', 'end fast']);
    expect(apply.mock.calls.map(([, , input]) => input.rows.length)).toEqual([3, 5]);
    expect(readDatasetIds(store)).toEqual(['explore-hot']);
    expect(rowsIn(store, 'explore-hot')).toBe(5);
  });

  it('runs the next request after one that failed', async () => {
    const failing = showExplorerResult(
      store,
      { sql: 'SELECT nope', label: 'X', mode: 'add' },
      chaskiWindow(0, 'Binder Error').win
    );
    const next = showExplorerResult(store, { sql: 'SELECT 1', label: 'Y', mode: 'add' }, chaskiWindow(2).win);
    expect(await failing).toBeNull();
    expect(await next).toBe('explore-y');
    expect(alerts).toEqual([{ type: 'error', payload: ['Map: could not show "X"', 'Binder Error'] }]);
  });
});

describe('useExplorerDatasets', () => {
  const realChaski = (window as any).__chaski;
  afterEach(() => {
    (window as any).__chaski = realChaski;
  });

  it("takes requests for its panel or for every panel, and ignores another panel's", async () => {
    (window as any).__chaski = chaskiWindow(2).win.__chaski;
    const { unmount } = renderHook(() => useExplorerDatasets({ store, isReady: true, panelId: 7 }));
    mockBus.publish(new ExplorerSideEvent({ sql: 'SELECT 1', label: 'Other', mode: 'add', panelId: 8 }));
    mockBus.publish(new ExplorerSideEvent({ sql: 'SELECT 1', label: 'Mine', mode: 'add', panelId: 7 }));
    mockBus.publish(new ExplorerSideEvent({ sql: 'SELECT 1', label: 'All', mode: 'add' }));
    await settle();
    expect(readDatasetIds(store).sort()).toEqual(['explore-all', 'explore-mine']);
    unmount();
    mockBus.publish(new ExplorerSideEvent({ sql: 'SELECT 1', label: 'Late', mode: 'add' }));
    await settle();
    expect(readDatasetIds(store)).not.toContain('explore-late');
  });

  it('listens only once kepler is ready', async () => {
    (window as any).__chaski = chaskiWindow(2).win.__chaski;
    renderHook(() => useExplorerDatasets({ store, isReady: false }));
    mockBus.publish(new ExplorerSideEvent({ sql: 'SELECT 1', label: 'Early', mode: 'add' }));
    await settle();
    expect(readDatasetIds(store)).toEqual([]);
  });
});
