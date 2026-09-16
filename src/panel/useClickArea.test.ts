import { renderHook } from '@testing-library/react';
import type { Store } from 'redux';

import { squareAround } from './clickArea';
import { KEPLER_INSTANCE_ID } from './constants';
import { useClickArea } from './useClickArea';

/**
 * The hook against a store it can read but not change: dispatches are recorded,
 * and each case moves the state itself to what kepler would have made of them.
 * That keeps the hook's own decisions — when to place, when to warn, when to
 * remove the stale square — apart from kepler's reducers, which
 * `clickAreaPipeline.test.ts` runs for real.
 */

interface Slices {
  clicked?: unknown;
  filters?: unknown[];
  editorFeatures?: unknown[];
  drawing?: boolean;
}

function makeStore(initial: Slices) {
  const layer = {
    id: 'puntos',
    type: 'point',
    config: {
      dataId: 'grafana-A',
      columns: { lat: { value: 'latitude', fieldIdx: 0 }, lng: { value: 'longitude', fieldIdx: 1 } },
    },
    getHoverData: (index: unknown, container: { rows: unknown[][] }) =>
      typeof index === 'number' ? container.rows[index] : null,
  };
  const datasets = {
    'grafana-A': {
      fields: [{ name: 'latitude' }, { name: 'longitude' }],
      dataContainer: {
        rows: [
          [39.25, -122.95],
          [38.1, -120.5],
          [null, null],
        ],
      },
    },
  };
  const build = ({ clicked, filters = [], editorFeatures = [], drawing = false }: Slices) => ({
    keplerGl: {
      [KEPLER_INSTANCE_ID]: {
        uiState: { mapControls: { mapDraw: { active: drawing } } },
        // New slice objects on every set, as a reducer would make them.
        visState: {
          clicked,
          filters: [...filters],
          editor: { features: [...editorFeatures] },
          datasets,
          animationConfig: {},
          layers: [layer],
        },
      },
    },
  });
  let state = build(initial);
  const subscribers: Array<() => void> = [];
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      subscribers.push(fn);
      return () => subscribers.splice(subscribers.indexOf(fn), 1);
    },
    dispatch: jest.fn(),
    set: (next: Slices) => {
      state = build(next);
      subscribers.forEach((fn) => fn());
    },
  };
}

type FakeStore = ReturnType<typeof makeStore>;

/** The kepler actions the hook dispatched, as `[type, payload]`. */
function dispatched(store: FakeStore) {
  return store.dispatch.mock.calls.map(([action]) => {
    const inner = (action as { payload: { type: string } & Record<string, unknown> }).payload;
    return inner;
  });
}

const click = (index: number) => ({ picked: true, index, object: null, layer: { props: { idx: 0 } } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(store: FakeStore, enabled = true) {
  return renderHook(() => useClickArea({ store: store as unknown as Store, isReady: true, enabled, sideMetres: 6000 }));
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

it('places a 6 km square around a clicked fire, through the editor', async () => {
  const store = makeStore({ clicked: undefined });
  mount(store);

  store.set({ clicked: click(0) });
  await flush();

  const actions = dispatched(store);
  expect(actions).toHaveLength(1);
  expect(actions[0].type).toBe('@@kepler.gl/SET_FEATURES');
  const [feature] = actions[0].features as Array<{ id: string; geometry: unknown; properties: unknown }>;
  expect(feature.geometry).toEqual(squareAround({ lng: -122.95, lat: 39.25 }, 6000));
  expect(feature.properties).toEqual({ isClosed: true });
  expect(feature.id).toMatch(/^click-/);
  expect(warn).not.toHaveBeenCalled();
});

it('changes nothing for a click on empty map', async () => {
  const hand = { id: 'hand', geometry: { type: 'Polygon', coordinates: [] } };
  const store = makeStore({ clicked: undefined, editorFeatures: [hand] });
  mount(store);

  store.set({ clicked: null, editorFeatures: [hand] });
  await flush();
  expect(store.dispatch).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

it('logs, and places nothing, when the clicked fire has no position', async () => {
  const store = makeStore({ clicked: undefined });
  mount(store);

  store.set({ clicked: click(2) });
  await flush();
  expect(store.dispatch).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toContain('puntos (point)');
  expect(warn.mock.calls[0][0]).toContain('no numeric latitude/longitude');
});

it('leaves a click alone while the draw toolbar is engaged', async () => {
  const store = makeStore({ clicked: undefined, drawing: true });
  mount(store);

  store.set({ clicked: click(0), drawing: true });
  await flush();
  expect(store.dispatch).not.toHaveBeenCalled();
});

it('does not take the click state the map loaded with for a click', async () => {
  const store = makeStore({ clicked: click(0) });
  mount(store);
  await flush();
  expect(store.dispatch).not.toHaveBeenCalled();
});

it('does nothing at all when the option is off', async () => {
  const store = makeStore({ clicked: undefined });
  mount(store, false);

  store.set({ clicked: click(0) });
  await flush();
  expect(store.dispatch).not.toHaveBeenCalled();
});

it('draw, then click: a rectangle filter goes the way the delete tool removes it', async () => {
  const rect = { id: 'rect', geometry: { type: 'Polygon', coordinates: [] }, properties: { filterId: 'f1' } };
  const filters = [{ id: 'f1', type: 'polygon', value: rect }];
  const store = makeStore({ clicked: undefined, filters });
  mount(store);

  store.set({ clicked: click(0), filters });
  await flush();

  const actions = dispatched(store);
  expect(actions.map((action) => action.type)).toEqual(['@@kepler.gl/SET_FEATURES', '@@kepler.gl/DELETE_FEATURE']);
  expect(actions[1].feature).toEqual({ id: 'rect', properties: { filterId: 'f1' } });
});

it('click, then draw: the stale square is removed once another figure appears', async () => {
  const store = makeStore({ clicked: undefined });
  mount(store);

  // kepler keeps the same `clicked` object until the next click.
  const clicked = click(0);
  store.set({ clicked });
  await flush();
  const square = (dispatched(store)[0].features as Array<{ id: string; geometry: unknown }>)[0];
  store.dispatch.mockClear();

  // kepler applies it: the square is the only figure. Nothing more happens.
  const placed = { id: square.id, geometry: square.geometry };
  store.set({ clicked, editorFeatures: [placed] });
  await flush();
  expect(store.dispatch).not.toHaveBeenCalled();

  // The user draws a polygon of their own.
  const hand = { id: 'hand', geometry: { type: 'Polygon', coordinates: [] } };
  store.set({ clicked, editorFeatures: [placed, hand] });
  await flush();
  const actions = dispatched(store);
  expect(actions.map((action) => action.type)).toEqual(['@@kepler.gl/DELETE_FEATURE']);
  expect(actions[0].feature).toEqual({ id: square.id, properties: {} });
});

it('a second click replaces the first square with a new one', async () => {
  const store = makeStore({ clicked: undefined });
  mount(store);

  const firstClick = click(0);
  store.set({ clicked: firstClick });
  await flush();
  const first = (dispatched(store)[0].features as Array<{ id: string; geometry: unknown }>)[0];
  store.set({ clicked: firstClick, editorFeatures: [{ id: first.id, geometry: first.geometry }] });
  await flush();
  store.dispatch.mockClear();

  store.set({ clicked: click(1), editorFeatures: [{ id: first.id, geometry: first.geometry }] });
  await flush();
  const actions = dispatched(store);
  expect(actions.map((action) => action.type)).toEqual(['@@kepler.gl/SET_FEATURES']);
  const [second] = actions[0].features as Array<{ id: string; geometry: unknown }>;
  expect(second.geometry).toEqual(squareAround({ lng: -120.5, lat: 38.1 }, 6000));
  expect(second.id).not.toBe(first.id);
});
