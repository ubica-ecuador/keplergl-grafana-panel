import { tableFromArrays, tableToIPC } from 'apache-arrow';

import { queryChaski } from './chaskiSource';

function fakeWindow(opts: { apiVersion?: number; started?: boolean } = {}) {
  const calls: Array<{ sql: string; opts: unknown }> = [];
  const api = {
    queryIPC: async (sql: string, queryOpts: unknown) => {
      calls.push({ sql, opts: queryOpts });
      return tableToIPC(tableFromArrays({ n: Int32Array.from([7]) }), 'stream');
    },
  };
  const win = {
    __chaski: { apiVersion: opts.apiVersion ?? 1, engine: () => (opts.started === false ? undefined : Promise.resolve(api)) },
  };
  return { win, calls };
}

describe('queryChaski', () => {
  it('runs the SQL as a panel consumer and decodes the IPC with our own apache-arrow', async () => {
    const { win, calls } = fakeWindow();
    const result = await queryChaski('SELECT 7 AS n', win);
    expect(calls).toEqual([{ sql: 'SELECT 7 AS n', opts: { consumer: 'panel' } }]);
    expect(result.ok && result.table.get(0)?.n).toBe(7);
  });

  it('says why when there is no engine to ask', async () => {
    expect(await queryChaski('SELECT 1', {})).toEqual({ ok: false, reason: 'absent' });
    expect(await queryChaski('SELECT 1', fakeWindow({ apiVersion: 2 }).win)).toEqual({ ok: false, reason: 'version' });
    expect(await queryChaski('SELECT 1', fakeWindow({ started: false }).win)).toEqual({ ok: false, reason: 'not-started' });
  });

  it('lets a failing query reject', async () => {
    const win = {
      __chaski: {
        apiVersion: 1,
        engine: async () => ({
          queryIPC: async () => {
            throw new Error('Binder Error: column "nope" not found');
          },
        }),
      },
    };
    await expect(queryChaski('SELECT nope', win)).rejects.toThrow('nope');
  });
});
