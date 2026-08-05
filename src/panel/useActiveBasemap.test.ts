import { act, renderHook } from '@testing-library/react';
import type { Store } from 'redux';

// keplerAdapter.ts imports `processRowObject` from `@kepler.gl/processors`,
// which pulls in `@loaders.gl/parquet` -> `parquet-wasm`, an ESM-only module
// Jest cannot parse (it is outside transformIgnorePatterns). None of this
// hook's code path touches processors, so the module is stubbed out purely to
// let the import chain resolve under Jest — the same reason no other test in
// this directory imports keplerAdapter.ts directly.
jest.mock('@kepler.gl/processors', () => ({ processRowObject: jest.fn() }));

import { KEPLER_INSTANCE_ID } from './constants';
import { readBasemapId } from './keplerAdapter';
import { useActiveBasemap } from './useActiveBasemap';

describe('readBasemapId', () => {
  it('returns the styleType from a plain fake store shape', () => {
    const store = {
      getState: () => ({ keplerGl: { [KEPLER_INSTANCE_ID]: { mapStyle: { styleType: 'grafana-satellite' } } } }),
    } as unknown as Store;

    expect(readBasemapId(store)).toBe('grafana-satellite');
  });

  it('returns null when the slice is missing — before kepler registers', () => {
    expect(readBasemapId({ getState: () => ({}) } as unknown as Store)).toBeNull();
  });

  it('returns null when the instance exists but mapStyle does not', () => {
    const store = {
      getState: () => ({ keplerGl: { [KEPLER_INSTANCE_ID]: {} } }),
    } as unknown as Store;

    expect(readBasemapId(store)).toBeNull();
  });
});

/** A minimal fake redux store, just enough for a `store.subscribe` consumer. */
function fakeStore(initialStyleType: string | null) {
  let styleType = initialStyleType;
  const listeners: Array<() => void> = [];
  const dispatch = jest.fn();

  return {
    getState: () => ({ keplerGl: { [KEPLER_INSTANCE_ID]: { mapStyle: { styleType } } } }),
    subscribe: (fn: () => void) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) {
          listeners.splice(i, 1);
        }
      };
    },
    dispatch,
    // Test helper, not part of the Store interface: flips the fake mapStyle
    // slice and notifies subscribers, the way a kepler reducer would.
    setStyleType(next: string | null) {
      styleType = next;
      listeners.forEach((fn) => fn());
    },
  };
}

describe('useActiveBasemap', () => {
  it('stays null until the map is ready, even with a style already in the store', () => {
    const store = fakeStore('grafana-satellite');
    const { result } = renderHook(() => useActiveBasemap({ store: store as unknown as Store, isReady: false }));

    expect(result.current).toBeNull();
  });

  it('reads the active style once the map is ready', () => {
    const store = fakeStore('grafana-satellite');
    const { result } = renderHook(() => useActiveBasemap({ store: store as unknown as Store, isReady: true }));

    expect(result.current).toBe('grafana-satellite');
  });

  it('updates when the store reports a style change', () => {
    const store = fakeStore('positron');
    const { result } = renderHook(() => useActiveBasemap({ store: store as unknown as Store, isReady: true }));

    act(() => store.setStyleType('grafana-satellite'));

    expect(result.current).toBe('grafana-satellite');
  });

  it('never dispatches — this hook only reads', () => {
    const store = fakeStore('positron');
    renderHook(() => useActiveBasemap({ store: store as unknown as Store, isReady: true }));

    act(() => store.setStyleType('grafana-satellite'));

    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
