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
  /** Main-thread performance.now() when the transition happened. */
  at: number;
  /** Work the datasource has in flight after the transition. */
  pending: number;
}

export class DuckdbWasmActivityEvent extends BusEventWithPayload<DuckdbWasmActivity> {
  static type = 'ubica-duckdbwasm-activity';
}

/**
 * Calls `onSignal` for each activity event that keeps the contract; the
 * returned function unsubscribes. Never throws.
 */
export function subscribeActivity(onSignal: (signal: GateSignal) => void): () => void {
  try {
    const subscription = getAppEvents().subscribe(DuckdbWasmActivityEvent, (event) => {
      const signal = signalOf(event.payload);
      if (signal) {
        onSignal(signal);
      }
    });
    return () => subscription.unsubscribe();
  } catch {
    return () => undefined;
  }
}

/**
 * The payload as a gate signal, or null when it does not keep the contract.
 *
 * The type string is public, on a bus every plugin on the page shares, so the
 * payload is checked rather than trusted. Without a payload the handler would
 * throw on every event; an `at` that is not a number would slip past the
 * gate's check for events from before a publish and hold every step to the
 * cap; an unknown state would count as settled.
 */
function signalOf(payload: Partial<DuckdbWasmActivity> | null | undefined): GateSignal | null {
  if (
    (payload?.state === 'busy' || payload?.state === 'settled') &&
    typeof payload.at === 'number' &&
    Number.isFinite(payload.at)
  ) {
    return { state: payload.state, at: payload.at };
  }
  return null;
}
