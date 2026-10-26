import { BusEventWithPayload, EventBusSrv } from '@grafana/data';

import { sayTimeWindow, subscribeTimeWindow, TimeWindowEvent } from './timeWindowEvent';

const mockBus = new EventBusSrv();
jest.mock('@grafana/runtime', () => ({ getAppEvents: () => mockBus }));

/** What the Time Brush publishes: its own class, with the same type string. */
class BrushSideEvent extends BusEventWithPayload<unknown> {
  static type = 'ubica-time-window';
}

const said = { variables: { from: 't0', to: 't1' }, window: { from: 10, to: 20 }, playing: true };

describe('the time window contract', () => {
  it('pins the event type', () => {
    expect(TimeWindowEvent.type).toBe('ubica-time-window');
  });

  it('hears a window said by another plugin, and says one itself', () => {
    const heard = jest.fn();
    const stop = subscribeTimeWindow(heard);
    mockBus.publish(new BrushSideEvent(said));
    sayTimeWindow({ ...said, playing: false });
    stop();
    sayTimeWindow(said);
    expect(heard.mock.calls).toEqual([[said], [{ ...said, playing: false }]]);
  });

  it('ignores payloads that break the contract', () => {
    const heard = jest.fn();
    const stop = subscribeTimeWindow(heard);
    for (const payload of [
      undefined,
      { ...said, variables: { from: 't0' } },
      { ...said, variables: { from: '', to: 't1' } },
      { ...said, window: { from: 'a', to: 20 } },
      { ...said, window: { from: 30, to: 20 } },
      { ...said, window: { from: 10, to: Infinity } },
      { ...said, playing: 'yes' },
    ]) {
      mockBus.publish(new BrushSideEvent(payload));
    }
    stop();
    expect(heard).not.toHaveBeenCalled();
  });
});
