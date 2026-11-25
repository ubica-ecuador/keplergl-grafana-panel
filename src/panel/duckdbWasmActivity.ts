import type { GateSignal } from './publishGate';
import type { ChaskiLink } from './pluginLinks';

/**
 * The DuckDB-WASM engine's activity, as the Chaski app lends it (`pluginLinks.ts`).
 *
 * The engine says when the panels it answers start and finish; a map writing
 * variables while it plays waits for them. On a Grafana without the Chaski app
 * (Grafana Cloud among them) there is no link and the panel hears nothing. The
 * payload is a contract with that plugin; the test pins it.
 */
export interface DuckdbWasmActivity {
  state: 'busy' | 'settled';
  /** Main-thread performance.now() when the transition happened. */
  at: number;
  /** Work the datasource has in flight after the transition. */
  pending: number;
}

/**
 * Calls `onSignal` for each activity payload that keeps the contract; the
 * returned function unsubscribes. Never throws.
 */
export function subscribeActivity(link: ChaskiLink | undefined, onSignal: (signal: GateSignal) => void): () => void {
  if (!link) {
    return () => undefined;
  }
  try {
    const unsubscribe = link.subscribeActivity((payload) => {
      const signal = signalOf(payload as Partial<DuckdbWasmActivity> | null | undefined);
      if (signal) {
        onSignal(signal);
      }
    });
    return () => {
      try {
        unsubscribe();
      } catch {
        // Gone already.
      }
    };
  } catch {
    return () => undefined;
  }
}

/**
 * The payload as a gate signal, or null when it does not keep the contract.
 *
 * The payload comes from another plugin, so it is checked rather than
 * trusted. Without a payload the handler would
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
