import type { TimeWindowLink } from './pluginLinks';
import { sayTimeWindow, subscribeTimeWindow } from './timeWindowEvent';

/** A time window link as the Kepler Plus app lends it: whatever is said reaches every listener. */
function fakeLink(): TimeWindowLink {
  const listeners = new Set<(said: unknown) => void>();
  return {
    say: (said) => listeners.forEach((listener) => listener(said)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const said = { variables: { from: 't0', to: 't1' }, window: { from: 10, to: 20 }, playing: true };

describe('the time window contract', () => {
  it('hears a window said through the link, and says one itself', () => {
    const link = fakeLink();
    const heard = jest.fn();
    const stop = subscribeTimeWindow(link, heard);
    link.say(said);
    sayTimeWindow(link, { ...said, playing: false });
    stop();
    sayTimeWindow(link, said);
    expect(heard.mock.calls).toEqual([[said], [{ ...said, playing: false }]]);
  });

  it('ignores payloads that break the contract', () => {
    const link = fakeLink();
    const heard = jest.fn();
    const stop = subscribeTimeWindow(link, heard);
    for (const payload of [
      undefined,
      { ...said, variables: { from: 't0' } },
      { ...said, variables: { from: '', to: 't1' } },
      { ...said, window: { from: 'a', to: 20 } },
      { ...said, window: { from: 30, to: 20 } },
      { ...said, window: { from: 10, to: Infinity } },
      { ...said, playing: 'yes' },
    ]) {
      link.say(payload);
    }
    stop();
    expect(heard).not.toHaveBeenCalled();
  });

  it('says and hears nothing without a link, and never throws', () => {
    const heard = jest.fn();
    expect(() => sayTimeWindow(undefined, said)).not.toThrow();
    expect(() => subscribeTimeWindow(undefined, heard)()).not.toThrow();
    expect(heard).not.toHaveBeenCalled();
  });
});
