import { renderHook } from '@testing-library/react';
import { FieldType, toDataFrame, type DataFrame } from '@grafana/data';
import type { Store } from 'redux';

import { KEPLER_INSTANCE_ID } from './constants';
import type { BoxedLayer } from './useBoxFraming';
import { useLayerFraming } from './useLayerFraming';

const ECUADOR: [number, number, number, number] = [-81, -5, -75, 1.5];
const PERU: [number, number, number, number] = [-81.4, -18.4, -68.7, -0.1];
/** Where the rows of the first layer are, as kepler's layer measures them. */
const CUENCA_ROWS: [number, number, number, number] = [-79.1, -3, -78.9, -2.8];
/** Where the rows of the second are. */
const QUITO_ROWS: [number, number, number, number] = [-78.6, -0.3, -78.4, -0.1];

/** A query's answer naming its layer: `rows` rows, `bbox` when given. */
function frames(key: string, bbox?: number[] | null, rows = 3, refId = 'A'): DataFrame[] {
  return [
    toDataFrame({
      refId,
      meta: { custom: { layer: bbox === undefined ? { key } : { key, bbox } } } as never,
      fields: [{ name: 'v', type: FieldType.number, values: Array.from({ length: rows }, (_, i) => i) }],
    }),
  ];
}

/** A store as far as the hook reads it: one layer on grafana-A whose bounds a test moves, and the actions sent. */
function fakeStore(bounds: number[] | null = CUENCA_ROWS) {
  const listeners = new Set<() => void>();
  const layer = { config: { dataId: 'grafana-A' }, meta: { bounds } };
  const state = {
    keplerGl: {
      [KEPLER_INSTANCE_ID]: {
        visState: {
          layers: [layer, { config: { dataId: 'grafana-B' }, meta: { bounds: [0, 40, 10, 50] } }],
          datasets: {},
        },
        mapState: { width: 800, height: 600, latitude: -2.9, longitude: -79, zoom: 12 },
      },
    },
  };
  const dispatched: any[] = [];
  const store = {
    getState: () => state,
    dispatch: (action: unknown) => {
      dispatched.push(action);
      return action;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as Store;
  /** kepler's layer on grafana-A measuring other rows, as a replace of them leaves it. */
  const moveRows = (next: number[] | null) => {
    layer.meta = { bounds: next };
    listeners.forEach((listener) => listener());
  };
  const emit = () => listeners.forEach((listener) => listener());
  return { store, dispatched, moveRows, emit, listeners };
}

/** The bounds of every fitBounds the hook sent, through kepler's instance wrapper. */
const fits = (dispatched: any[]) =>
  dispatched.map((action) => action?.payload?.payload ?? action?.payload).filter((p) => Array.isArray(p));

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function mount(store: Store, first: DataFrame[], boxed: BoxedLayer[] = []) {
  const onFramed = jest.fn();
  const hook = renderHook(
    ({ frames: current, boxed: layers }: { frames: DataFrame[]; boxed: BoxedLayer[] }) =>
      useLayerFraming({ store, isReady: true, frames: current, boxed: layers, width: 800, height: 600, onFramed }),
    { initialProps: { frames: first, boxed } }
  );
  return { ...hook, onFramed };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useLayerFraming', () => {
  it('only records the first answer, box and all', async () => {
    const { store, dispatched } = fakeStore();
    mount(store, frames('ecuador', ECUADOR));
    await flush();
    jest.advanceTimersByTime(2_000);
    await flush();
    expect(fits(dispatched)).toEqual([]);
  });

  it('frames another layer on its box at once, and tells the guard', async () => {
    const { store, dispatched } = fakeStore();
    const { rerender, onFramed } = mount(store, frames('ecuador', ECUADOR));
    rerender({ frames: frames('peru', PERU), boxed: [] });
    await flush();
    expect(fits(dispatched)).toEqual([PERU]);
    expect(onFramed).toHaveBeenCalledWith({ bounds: PERU });
  });

  it('moves nothing on a refresh of the same layer', async () => {
    const { store, dispatched, moveRows } = fakeStore();
    const { rerender } = mount(store, frames('ecuador', ECUADOR));
    rerender({ frames: frames('ecuador', ECUADOR, 5), boxed: [] });
    rerender({ frames: frames('ecuador', null, 5), boxed: [] });
    moveRows(QUITO_ROWS);
    jest.advanceTimersByTime(2_000);
    await flush();
    expect(fits(dispatched)).toEqual([]);
  });

  it('frames another layer with no box on its rows once they reach its layer, and lets the user pan after', async () => {
    const { store, dispatched, moveRows, emit } = fakeStore();
    const { rerender } = mount(store, frames('cuenca'));
    rerender({ frames: frames('quito'), boxed: [] });
    await flush();
    // Still the old layer's rows: nothing yet.
    expect(fits(dispatched)).toEqual([]);

    moveRows(QUITO_ROWS);
    await flush();
    expect(fits(dispatched)).toEqual([QUITO_ROWS]);

    // The user pans; the rows stay where they are.
    jest.advanceTimersByTime(1_000);
    emit();
    await flush();
    expect(fits(dispatched)).toEqual([QUITO_ROWS]);
  });

  it('frames another layer lying where the old one did, once, when its rows have had time to land', async () => {
    const { store, dispatched, emit } = fakeStore();
    const { rerender } = mount(store, frames('cuenca-2025'));
    rerender({ frames: frames('cuenca-2026'), boxed: [] });
    await flush();
    expect(fits(dispatched)).toEqual([]);

    jest.advanceTimersByTime(800);
    await flush();
    expect(fits(dispatched)).toEqual([CUENCA_ROWS]);

    emit();
    await flush();
    expect(fits(dispatched)).toEqual([CUENCA_ROWS]);
  });

  it('lets go of a switch on the first refresh of the new layer once it framed something', async () => {
    const { store, dispatched, moveRows } = fakeStore();
    const { rerender } = mount(store, frames('cuenca-2025'));
    rerender({ frames: frames('cuenca-2026'), boxed: [] });
    jest.advanceTimersByTime(800);
    await flush();
    expect(fits(dispatched)).toEqual([CUENCA_ROWS]);

    rerender({ frames: frames('cuenca-2026', null, 4), boxed: [] });
    moveRows(QUITO_ROWS);
    await flush();
    expect(fits(dispatched)).toEqual([CUENCA_ROWS]);
  });

  it('frames the box of another layer that answered no rows, and keeps the view with no box', async () => {
    const empty = fakeStore();
    const boxed = mount(empty.store, frames('cuenca'));
    boxed.rerender({ frames: frames('peru', PERU, 0), boxed: [] });
    await flush();
    expect(fits(empty.dispatched)).toEqual([PERU]);

    const none = fakeStore();
    const { rerender } = mount(none.store, frames('cuenca'));
    rerender({ frames: frames('nowhere', null, 0), boxed: [] });
    jest.advanceTimersByTime(2_000);
    await flush();
    expect(fits(none.dispatched)).toEqual([]);
  });

  it('leaves a query whose service is framed on its own box to that framing', async () => {
    const { store, dispatched } = fakeStore();
    const wms = (identity: string): BoxedLayer => ({ id: 'grafana-A-wms', identity, bbox: PERU });
    const { rerender } = mount(store, frames('wms-a', ECUADOR), [wms('a')]);
    rerender({ frames: frames('wms-b', PERU), boxed: [wms('b')] });
    jest.advanceTimersByTime(2_000);
    await flush();
    expect(fits(dispatched)).toEqual([]);
  });

  it('reads only the bounds of the query that changed layer', async () => {
    const { store, dispatched, moveRows } = fakeStore();
    const both = (a: string, b: string) => [...frames(a), ...frames(b, null, 3, 'B')];
    const { rerender } = mount(store, both('cuenca', 'europe'));
    rerender({ frames: both('quito', 'europe'), boxed: [] });
    moveRows(QUITO_ROWS);
    await flush();
    expect(fits(dispatched)).toEqual([QUITO_ROWS]);
  });

  it('gives up on rows that never come', async () => {
    const { store, dispatched, moveRows, listeners } = fakeStore(null);
    const { rerender } = mount(store, frames('cuenca'));
    rerender({ frames: frames('quito'), boxed: [] });
    jest.advanceTimersByTime(61_000);
    await flush();
    expect(listeners.size).toBe(0);
    moveRows(QUITO_ROWS);
    await flush();
    expect(fits(dispatched)).toEqual([]);
  });
});
