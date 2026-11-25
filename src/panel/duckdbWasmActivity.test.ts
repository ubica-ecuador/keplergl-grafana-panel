import { subscribeActivity } from './duckdbWasmActivity';
import type { ChaskiLink } from './pluginLinks';

/** A Chaski link whose activity the test drives. */
function fakeLink() {
  const listeners = new Set<(payload: unknown) => void>();
  const link: ChaskiLink = {
    subscribeActivity: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mosaicRuntime: () => Promise.reject(new Error('not in this test')),
  };
  return { link, say: (payload: unknown) => listeners.forEach((listener) => listener(payload)), listeners };
}

describe('the DuckDB-WASM activity contract', () => {
  it("hears the engine's activity through the Chaski link, and passes state and time on", () => {
    const { link, say } = fakeLink();
    const heard: unknown[] = [];
    const unsubscribe = subscribeActivity(link, (signal) => heard.push(signal));
    say({ state: 'busy', at: 12.5, pending: 1 });
    say({ state: 'settled', at: 40, pending: 0 });
    unsubscribe();
    say({ state: 'busy', at: 50, pending: 1 });
    expect(heard).toEqual([
      { state: 'busy', at: 12.5 },
      { state: 'settled', at: 40 },
    ]);
  });

  it('ignores payloads that do not keep the contract', () => {
    const { link, say } = fakeLink();
    const heard: unknown[] = [];
    const unsubscribe = subscribeActivity(link, (signal) => heard.push(signal));
    for (const payload of [
      undefined,
      null,
      { state: 'busy', at: undefined, pending: 1 },
      { state: 'busy', at: Number.NaN, pending: 1 },
      { state: 'busy', at: '12', pending: 1 },
      { state: 'other', at: 12, pending: 0 },
    ]) {
      say(payload);
    }
    unsubscribe();
    expect(heard).toEqual([]);
  });

  it('hears nothing, and never throws, without a link or with one that fails', () => {
    const heard = jest.fn();
    expect(() => subscribeActivity(undefined, heard)()).not.toThrow();
    const failing: ChaskiLink = {
      subscribeActivity: () => {
        throw new Error('broken');
      },
      mosaicRuntime: () => Promise.reject(new Error('broken')),
    };
    expect(() => subscribeActivity(failing, heard)()).not.toThrow();
    expect(heard).not.toHaveBeenCalled();
  });
});
