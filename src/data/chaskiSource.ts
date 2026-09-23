import { tableFromIPC, type Table } from 'apache-arrow';

/**
 * The part of Chaski's `window.__chaski` (API version 1) the panel uses. Found
 * at runtime, never imported: the panel is published where Chaski is usually
 * absent. Results arrive as Arrow IPC, decoded here with this bundle's own
 * apache-arrow — Chaski's Table objects would not work with our copy.
 */
interface ChaskiLike {
  apiVersion: number;
  engine():
    | Promise<{ queryIPC(sql: string, opts?: { signal?: AbortSignal; consumer?: 'explorer' | 'panel' }): Promise<Uint8Array> }>
    | undefined;
}

export type ChaskiQuery = { ok: true; table: Table } | { ok: false; reason: 'absent' | 'not-started' | 'version' };

/** Runs `sql` on Chaski's engine as a panel. Resolves with why not when there is no engine; rejects when the query fails. */
export async function queryChaski(sql: string, win: object = window): Promise<ChaskiQuery> {
  const chaski = (win as { __chaski?: ChaskiLike }).__chaski;
  if (!chaski) {
    return { ok: false, reason: 'absent' };
  }
  if (chaski.apiVersion !== 1) {
    return { ok: false, reason: 'version' };
  }
  const engine = chaski.engine();
  if (!engine) {
    return { ok: false, reason: 'not-started' };
  }
  const api = await engine;
  return { ok: true, table: tableFromIPC(await api.queryIPC(sql, { consumer: 'panel' })) };
}
