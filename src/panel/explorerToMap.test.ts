import { BusEventWithPayload, EventBusSrv } from '@grafana/data';

import { ExplorerToMapEvent, requestOf, subscribeExplorerToMap } from './explorerToMap';

const mockBus = new EventBusSrv();
jest.mock('@grafana/runtime', () => ({ getAppEvents: () => mockBus }));

/** What the explorer publishes: its own class, with the same type string. */
class ExplorerSideEvent extends BusEventWithPayload<unknown> {
  static type = 'ubica-explorer-to-map';
}

describe('the explorer-to-map contract', () => {
  it('pins the event type', () => {
    expect(ExplorerToMapEvent.type).toBe('ubica-explorer-to-map');
  });

  it("hears the explorer's own event class", () => {
    const heard: unknown[] = [];
    const stop = subscribeExplorerToMap((request) => heard.push(request));
    mockBus.publish(new ExplorerSideEvent({ sql: 'SELECT 1', label: 'One', mode: 'add' }));
    mockBus.publish(
      new ExplorerSideEvent({ sql: 'SELECT g FROM t', label: 'Two', mode: 'replace', geometryColumn: 'g', panelId: 4 })
    );
    stop();
    mockBus.publish(new ExplorerSideEvent({ sql: 'SELECT 1', label: 'Late', mode: 'add' }));
    expect(heard).toEqual([
      { sql: 'SELECT 1', label: 'One', mode: 'add' },
      { sql: 'SELECT g FROM t', label: 'Two', mode: 'replace', geometryColumn: 'g', panelId: 4 },
    ]);
  });

  it.each([
    undefined,
    null,
    {},
    { sql: '', label: 'x', mode: 'add' },
    { sql: '   ', label: 'x', mode: 'add' },
    { sql: 'SELECT 1', label: '', mode: 'add' },
    { sql: 'SELECT 1', label: 'x', mode: 'merge' },
    { sql: 'SELECT 1', label: 'x', mode: 'add', geometryColumn: 3 },
    { sql: 'SELECT 1', label: 'x', mode: 'add', geometryColumn: '' },
    { sql: 'SELECT 1', label: 'x', mode: 'add', panelId: 'four' },
    { sql: 'SELECT 1', label: 'x', mode: 'add', panelId: Number.NaN },
  ])('rejects a payload that does not keep the contract: %p', (payload) => {
    expect(requestOf(payload)).toBeNull();
  });

  it('ignores such payloads on the bus without throwing', () => {
    jest.useFakeTimers();
    try {
      const heard: unknown[] = [];
      const stop = subscribeExplorerToMap((request) => heard.push(request));
      mockBus.publish({ type: 'ubica-explorer-to-map' });
      mockBus.publish(new ExplorerSideEvent({ sql: 42 }));
      expect(() => jest.runOnlyPendingTimers()).not.toThrow();
      stop();
      expect(heard).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});
