import { BusEventWithPayload } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

/**
 * A request from the SQLRooms explorer to show a query's result on the map,
 * declared on this side.
 *
 * Grafana's event bus matches events by their `type` string, so the panel
 * hears the explorer without importing it; where the explorer is not installed
 * the panel simply never hears anything. The string and the payload are a
 * contract with that plugin; the test pins both.
 */
export interface ExplorerToMap {
  /** Runs on Chaski's engine; may read datasets.* and explore.* */
  sql: string;
  /** Shown in kepler, and the key `replace` matches on. */
  label: string;
  /** A GEOMETRY column to draw. Without one, kepler looks for lat/lon columns. */
  geometryColumn?: string;
  mode: 'add' | 'replace';
  /** Only this panel takes it; absent, every kepler panel on the dashboard does. */
  panelId?: number;
}

export class ExplorerToMapEvent extends BusEventWithPayload<ExplorerToMap> {
  static type = 'ubica-explorer-to-map';
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * The payload as a request, or null when it does not keep the contract. The
 * type string is public, on a bus every plugin on the page shares, so the
 * payload is checked rather than trusted.
 */
export function requestOf(payload: unknown): ExplorerToMap | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const { sql, label, geometryColumn, mode, panelId } = payload as Record<string, unknown>;
  if (!nonEmpty(sql) || !nonEmpty(label) || (mode !== 'add' && mode !== 'replace')) {
    return null;
  }
  if (geometryColumn !== undefined && !nonEmpty(geometryColumn)) {
    return null;
  }
  if (panelId !== undefined && !(typeof panelId === 'number' && Number.isFinite(panelId))) {
    return null;
  }
  return {
    sql,
    label,
    mode,
    ...(geometryColumn !== undefined ? { geometryColumn } : {}),
    ...(panelId !== undefined ? { panelId } : {}),
  };
}

/** Calls `onRequest` for each event that keeps the contract; the returned function unsubscribes. Never throws. */
export function subscribeExplorerToMap(onRequest: (request: ExplorerToMap) => void): () => void {
  try {
    const subscription = getAppEvents().subscribe(ExplorerToMapEvent, (event) => {
      const request = requestOf(event.payload);
      if (request) {
        onRequest(request);
      }
    });
    return () => subscription.unsubscribe();
  } catch {
    return () => undefined;
  }
}
