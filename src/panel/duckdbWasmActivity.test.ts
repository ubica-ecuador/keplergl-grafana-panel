import { BusEventWithPayload, EventBusSrv } from '@grafana/data';

import { DuckdbWasmActivityEvent, subscribeActivity } from './duckdbWasmActivity';

const mockBus = new EventBusSrv();
jest.mock('@grafana/runtime', () => ({ getAppEvents: () => mockBus }));

/** What the datasource publishes: its own class, with the same type string. */
class DatasourceSideEvent extends BusEventWithPayload<{ state: 'busy' | 'settled'; at: number; pending: number }> {
  static type = 'ubica-duckdbwasm-activity';
}

describe('the DuckDB-WASM activity contract', () => {
  it('pins the event type the datasource publishes', () => {
    expect(DuckdbWasmActivityEvent.type).toBe('ubica-duckdbwasm-activity');
  });

  it("hears the datasource's own event class, and passes state and time on", () => {
    const heard: unknown[] = [];
    const unsubscribe = subscribeActivity((signal) => heard.push(signal));
    mockBus.publish(new DatasourceSideEvent({ state: 'busy', at: 12.5, pending: 1 }));
    mockBus.publish(new DatasourceSideEvent({ state: 'settled', at: 40, pending: 0 }));
    unsubscribe();
    mockBus.publish(new DatasourceSideEvent({ state: 'busy', at: 50, pending: 1 }));
    expect(heard).toEqual([
      { state: 'busy', at: 12.5 },
      { state: 'settled', at: 40 },
    ]);
  });
});
