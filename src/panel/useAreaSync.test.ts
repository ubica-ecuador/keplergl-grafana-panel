import { renderHook } from '@testing-library/react';

import { useAreaSync } from './useAreaSync';

const partial = jest.fn();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    partial: (...args: unknown[]) => partial(...args),
  },
}));

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

function keplerState(features: unknown[]) {
  return {
    keplerGl: {
      grafana: {
        visState: { filters: [], datasets: {}, animationConfig: {}, editor: { features } },
      },
    },
  };
}

/** The slice of kepler state the hook reads, and a store that serves it. */
function makeStore(features: unknown[]) {
  let state = keplerState(features);
  const subscribers: Array<() => void> = [];
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      subscribers.push(fn);
      return () => {
        subscribers.splice(subscribers.indexOf(fn), 1);
      };
    },
    dispatch: jest.fn(),
    /** A figure is drawn, or moved. */
    setFeatures: (next: unknown[]) => {
      state = keplerState(next);
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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not clear the variable once the panel has torn down', async () => {
    const store = makeStore([]);
    const { unmount } = renderHook(() =>
      useAreaSync({ store: store as never, isReady: true, variable: 'area' })
    );

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
});
