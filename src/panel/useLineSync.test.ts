import { act, renderHook } from '@testing-library/react';

import { lineToWkt } from '../data/geoJsonToWkt';
import { lineFingerprints } from './areaSync';
import { useLineSync } from './useLineSync';

const partial = jest.fn();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    partial: (...args: unknown[]) => partial(...args),
    getSearch: () => new URLSearchParams(''),
    getHistory: () => ({ listen: () => () => undefined }),
  },
}));

/** A finished line, in the shape kepler keeps in `editor.features`. */
const line = (id: string, coordinates: number[][]) => ({ id, geometry: { type: 'LineString', coordinates } });
const square = (id: string) => ({
  id,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
});

/** The slice of kepler state the hook reads, and a store that serves it. */
function makeStore(features: unknown[]) {
  const stateOf = (f: unknown[]) => ({
    keplerGl: {
      grafana: { visState: { filters: [], datasets: {}, layers: [], animationConfig: {}, editor: { features: f } } },
    },
  });
  let state = stateOf(features);
  const subscribers: Array<() => void> = [];
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      subscribers.push(fn);
      return () => subscribers.splice(subscribers.indexOf(fn), 1);
    },
    dispatch: jest.fn(),
    setFeatures: (next: unknown[]) => {
      state = stateOf(next);
      subscribers.forEach((fn) => fn());
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    jest.advanceTimersByTime(400);
  });
}

describe('lineToWkt', () => {
  it('writes a LineString as canonical WKT, rounded, repeated positions dropped', () => {
    expect(
      lineToWkt({
        type: 'LineString',
        coordinates: [
          [-5.2312345678, 40.27, 1800],
          [-5.24, 40.26],
          [-5.24, 40.26],
        ],
      })
    ).toBe('LINESTRING (-5.231235 40.27, -5.24 40.26)');
  });

  it('refuses anything but a line of two places', () => {
    expect(lineToWkt({ type: 'LineString', coordinates: [[0, 0]] })).toBeNull();
    expect(
      lineToWkt({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [0, 0],
        ],
      })
    ).toBeNull();
    expect(lineToWkt({ type: 'Polygon', coordinates: [] })).toBeNull();
    expect(lineToWkt({ type: 'LineString', coordinates: [[0, 'a']] })).toBeNull();
  });

  it('counts the lines among the figures, never the areas', () => {
    expect(
      lineFingerprints([
        square('s') as never,
        line('l', [
          [0, 0],
          [1, 1],
        ]) as never,
      ])
    ).toEqual({
      l: 'LINESTRING (0 0, 1 1)',
    });
  });
});

describe('useLineSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    partial.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('adopts the lines a saved map arrives with, then publishes the line drawn, and clears it when deleted', async () => {
    const store = makeStore([
      line('saved', [
        [0, 0],
        [1, 1],
      ]),
    ]);
    renderHook(() => useLineSync({ store: store as never, isReady: true, variable: 'line' }));
    await flush();
    expect(partial).not.toHaveBeenCalled();

    act(() =>
      store.setFeatures([
        line('saved', [
          [0, 0],
          [1, 1],
        ]),
        square('area'),
        line('new', [
          [2, 2],
          [3, 3],
        ]),
      ])
    );
    await flush();
    expect(partial).toHaveBeenLastCalledWith({ 'var-line': 'LINESTRING (2 2, 3 3)' }, true);

    // A polygon drawn after it is the area's business, not the line's.
    act(() =>
      store.setFeatures([
        line('saved', [
          [0, 0],
          [1, 1],
        ]),
        line('new', [
          [2, 2],
          [3, 3],
        ]),
        square('other'),
      ])
    );
    await flush();
    expect(partial).toHaveBeenCalledTimes(1);

    // The published line deleted: the other line takes over; both gone: empty.
    act(() =>
      store.setFeatures([
        line('saved', [
          [0, 0],
          [1, 1],
        ]),
      ])
    );
    await flush();
    expect(partial).toHaveBeenLastCalledWith({ 'var-line': 'LINESTRING (0 0, 1 1)' }, true);
    act(() => store.setFeatures([]));
    await flush();
    expect(partial).toHaveBeenLastCalledWith({ 'var-line': '' }, true);
  });

  it('writes nothing without a variable', async () => {
    const store = makeStore([]);
    renderHook(() => useLineSync({ store: store as never, isReady: true, variable: '' }));
    act(() =>
      store.setFeatures([
        line('new', [
          [2, 2],
          [3, 3],
        ]),
      ])
    );
    await flush();
    expect(partial).not.toHaveBeenCalled();
  });
});
