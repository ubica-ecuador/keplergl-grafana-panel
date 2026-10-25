import { renderHook } from '@testing-library/react';

import { useAreaSync } from './useAreaSync';

const partial = jest.fn();
/** The URL's query, and who listens to it moving. */
let search = '';
const listeners: Array<() => void> = [];

jest.mock('@grafana/runtime', () => ({
  locationService: {
    partial: (...args: unknown[]) => partial(...args),
    getSearch: () => new URLSearchParams(search),
    getHistory: () => ({
      listen: (fn: () => void) => {
        listeners.push(fn);
        return () => listeners.splice(listeners.indexOf(fn), 1);
      },
    }),
  },
}));

/** The URL moves, by someone else's hand. */
function navigate(query: string) {
  search = query;
  listeners.forEach((fn) => fn());
}

/** The kepler action types the hook dispatched, unwrapped from `wrapTo`. */
function dispatched(dispatch: jest.Mock): string[] {
  return dispatch.mock.calls.map(([action]) => String(action.payload?.type ?? action.type));
}

/** A finished rectangle, in the shape kepler keeps in `editor.features`. */
function feature(id: string, lng: number) {
  return {
    id,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lng, 0],
          [lng + 1, 0],
          [lng + 1, 1],
          [lng, 1],
          [lng, 0],
        ],
      ],
    },
  };
}

function keplerState(features: unknown[], layers: unknown[] = []) {
  return {
    keplerGl: {
      grafana: {
        visState: { filters: [], datasets: {}, layers, animationConfig: {}, editor: { features } },
      },
    },
  };
}

/** The slice of kepler state the hook reads, and a store that serves it. */
function makeStore(features: unknown[], layers: unknown[] = []) {
  let state = keplerState(features, layers);
  const subscribers: Array<() => void> = [];
  const notify = () => subscribers.forEach((fn) => fn());
  // kepler applies its editor's figures synchronously; nothing else here needs reducing.
  const dispatch = jest.fn((action: { type?: string; payload?: { type?: string; features?: unknown[] } }) => {
    if (action.payload?.type === '@@kepler.gl/SET_FEATURES') {
      state = keplerState(action.payload.features ?? [], layers);
      notify();
    }
  });
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      subscribers.push(fn);
      return () => {
        subscribers.splice(subscribers.indexOf(fn), 1);
      };
    },
    dispatch,
    /** A figure is drawn, or moved. */
    setFeatures: (next: unknown[]) => {
      state = keplerState(next, layers);
      subscribers.forEach((fn) => fn());
    },
    /** What kepler does on unmount: its entry disappears from the store. */
    dropEntry: () => {
      state = { keplerGl: {} } as ReturnType<typeof keplerState>;
      subscribers.forEach((fn) => fn());
    },
  };
}

/** Runs the microtask the hook schedules its reconcile on. */
const flushMicrotasks = () => Promise.resolve().then(() => undefined);

describe('useAreaSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    partial.mockClear();
    search = '';
    listeners.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not clear the variable once the panel has torn down', async () => {
    const store = makeStore([]);
    const { unmount } = renderHook(() => useAreaSync({ store: store as never, isReady: true, variable: 'area' }));

    // First pass adopts an empty map without publishing, which is what arms
    // `lastSeen`. Then a figure is drawn and published, which is what sets
    // `publishedId` — the state in which a later absence reads as a clearing.
    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    store.setFeatures([feature('a', 0)]);
    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    expect(partial).toHaveBeenCalledTimes(1);
    partial.mockClear();

    store.dropEntry();
    unmount();
    await flushMicrotasks();
    jest.advanceTimersByTime(500);

    expect(partial).not.toHaveBeenCalled();
  });

  it('still clears the variable when the user deletes the last figure', async () => {
    const store = makeStore([]);
    renderHook(() => useAreaSync({ store: store as never, isReady: true, variable: 'area' }));

    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    store.setFeatures([feature('a', 0)]);
    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    partial.mockClear();

    store.setFeatures([]);
    await flushMicrotasks();
    jest.advanceTimersByTime(500);

    expect(partial).toHaveBeenCalledWith({ 'var-area': '' }, true);
  });

  it('resumes publishing after the effect tears down and re-arms for a new variable', async () => {
    const store = makeStore([]);
    const { rerender } = renderHook(
      ({ variable }: { variable: string }) => useAreaSync({ store: store as never, isReady: true, variable }),
      { initialProps: { variable: 'area' } }
    );

    // First pass adopts, then a figure is drawn and published under `area` —
    // the live, published state the teardown-and-rearm below must not retire.
    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    store.setFeatures([feature('a', 0)]);
    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    expect(partial).toHaveBeenCalledTimes(1);
    partial.mockClear();

    // A different `variable` prop tears the effect down (cleanup runs, same as
    // unmount) and re-arms it for the new mapping — the effect must reset
    // `disposed` back to false, or the hook stays retired for good.
    rerender({ variable: 'zone' });
    await flushMicrotasks();
    jest.advanceTimersByTime(500);

    store.setFeatures([feature('a', 0), feature('b', 5)]);
    await flushMicrotasks();
    jest.advanceTimersByTime(500);

    expect(partial).toHaveBeenCalledWith({ 'var-zone': expect.any(String) }, true);
  });

  it('removes the figures when a filters panel clears the variable', async () => {
    const store = makeStore([]);
    renderHook(() => useAreaSync({ store: store as never, isReady: true, variable: 'area' }));
    await flushMicrotasks();
    store.setFeatures([feature('a', 0)]);
    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    const [[written]] = partial.mock.calls;
    navigate(`var-area=${encodeURIComponent(written['var-area'])}`);
    expect(store.dispatch).not.toHaveBeenCalled();

    navigate('var-area=');

    expect(dispatched(store.dispatch)).toEqual(['@@kepler.gl/DELETE_FEATURE']);
  });

  it('does not take a timeline step for a cleared area', async () => {
    const store = makeStore([]);
    renderHook(() => useAreaSync({ store: store as never, isReady: true, variable: 'area' }));
    await flushMicrotasks();
    navigate('var-area=&var-t0=1');
    store.setFeatures([feature('a', 0)]);
    await flushMicrotasks();

    // Drawn, not yet written: the URL still says empty when the next step lands.
    navigate('var-area=&var-t0=2');
    jest.advanceTimersByTime(500);

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(partial).toHaveBeenCalledTimes(1);
  });

  it('draws an area that arrives in the link, once the map has a layer to filter by it', async () => {
    const layers: unknown[] = [];
    const store = makeStore([], layers);
    search = 'var-area=POLYGON%20((0%200,%201%200,%201%201,%200%200))';
    renderHook(() => useAreaSync({ store: store as never, isReady: true, variable: 'area' }));
    await flushMicrotasks();
    expect(store.dispatch).not.toHaveBeenCalled();

    // The rows arrive.
    layers.push({ id: 'points', type: 'point', config: { isVisible: true } });
    store.setFeatures([]);
    await flushMicrotasks();

    expect(dispatched(store.dispatch)).toEqual([
      '@@kepler.gl/SET_FEATURES',
      '@@kepler.gl/SET_POLYGON_FILTER_ALL_LAYERS',
    ]);
    jest.advanceTimersByTime(500);
    expect(partial).not.toHaveBeenCalled();
  });

  it('keeps the figure a saved config brings with the same area as the variable', async () => {
    const layers: unknown[] = [];
    const store = makeStore([], layers);
    search = `var-area=${encodeURIComponent('POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))')}`;
    renderHook(() => useAreaSync({ store: store as never, isReady: true, variable: 'area' }));
    await flushMicrotasks();

    layers.push({ id: 'points', type: 'point', config: { isVisible: true } });
    store.setFeatures([feature('saved', 0)]);
    await flushMicrotasks();
    jest.advanceTimersByTime(500);

    // Not drawn twice; at most written again as it is.
    expect(store.dispatch).not.toHaveBeenCalled();
    for (const [written] of partial.mock.calls) {
      expect(written).toEqual({ 'var-area': 'POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))' });
    }
  });
});
