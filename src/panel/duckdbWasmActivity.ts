import { BusEventWithPayload } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import type { GateSignal } from './publishGate';

/**
 * The DuckDB-WASM datasource's activity event, declared on this side.
 *
 * Grafana's event bus matches events by their `type` string, so the panel
 * hears that datasource without importing it. On a Grafana where it is not
 * installed (Grafana Cloud among them) the panel simply never hears anything.
 * The string and the payload are a contract with that plugin; the test pins
 * both.
 */
export interface DuckdbWasmActivity {
  state: 'busy' | 'settled';
  /** performance.now() when the transition happened. */
  at: number;
  /** Work the datasource has in flight after the transition. */
  pending: number;
}

export class DuckdbWasmActivityEvent extends BusEventWithPayload<DuckdbWasmActivity> {
  static type = 'ubica-duckdbwasm-activity';
}

/** Calls `onSignal` for each activity event; the returned function unsubscribes. Never throws. */
export function subscribeActivity(onSignal: (signal: GateSignal) => void): () => void {
  try {
    const subscription = getAppEvents().subscribe(DuckdbWasmActivityEvent, (event) =>
      onSignal({ state: event.payload.state, at: event.payload.at })
    );
    return () => subscription.unsubscribe();
  } catch {
    return () => undefined;
  }
}
