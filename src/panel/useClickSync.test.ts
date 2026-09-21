import { renderHook } from '@testing-library/react';

import { KEPLER_INSTANCE_ID } from './constants';
import { useClickSync } from './useClickSync';
import type { VariableMapping } from './variableSync';

const partial = jest.fn();
let search = new URLSearchParams();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    partial: (...args: unknown[]) => partial(...args),
    getSearch: () => search,
  },
}));

/**
 * When the click reaches the variables, and who is allowed to move them.
 *
 * The publish rules themselves live in `clickSync.ts` and are tested there
 * against literal values; what this pins is the hook's side of the confirm
 * mode: with it on, no gesture on the map writes anything — not the click,
 * not the empty-map deselect — and the only writers are the two actions the
 * popup's button calls.
 */

const site: VariableMapping = { field: 'site', variable: 'site', source: 'click' };

/** A store that serves one point layer whose rows carry a `site` column. */
function makeStore(clicked: unknown) {
  const layer = {
    id: 'points',
    type: 'point',
    props: { idx: 0 },
    config: { dataId: 'grafana-A' },
    getHoverData: (index: unknown, container: { rows: unknown[][] }) =>
      typeof index === 'number' ? container.rows[index] : null,
  };
  const build = (current: unknown) => ({
    keplerGl: {
      [KEPLER_INSTANCE_ID]: {
        uiState: { mapControls: { mapDraw: { active: false } } },
        visState: {
          clicked: current,
          layers: [layer],
          datasets: {
            'grafana-A': {
              fields: [{ name: 'site' }],
              dataContainer: { rows: [['site-07'], ['site-09']] },
            },
          },
          animationConfig: {},
          editor: { features: [] },
          filters: [],
        },
      },
    },
  });
  let state = build(clicked);
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
    /** What a click on the map leaves behind. */
    setClicked: (next: unknown) => {
      state = build(next);
      subscribers.forEach((fn) => fn());
    },
  };
}

/** kepler's click info for the row at `index` of the layer above. */
const clickOn = (index: number) => ({ layer: { props: { idx: 0 } }, index, object: index });

/** Runs the microtask the hook schedules its reconcile on. */
const flush = () => Promise.resolve().then(() => undefined);

beforeEach(() => {
  partial.mockClear();
  search = new URLSearchParams();
});

describe('without the confirm mode', () => {
  it('publishes the clicked entity as soon as it is clicked', async () => {
    const store = makeStore(undefined);
    renderHook(() => useClickSync({ store: store as never, isReady: true, mappings: [site] }));
    await flush();

    store.setClicked(clickOn(0));
    await flush();

    expect(partial).toHaveBeenCalledWith({ 'var-site': 'site-07' }, true);
  });
});

describe('with the confirm mode on', () => {
  it('publishes nothing when the entity is merely clicked', async () => {
    const store = makeStore(undefined);
    renderHook(() => useClickSync({ store: store as never, isReady: true, mappings: [site], confirm: true }));
    await flush();

    store.setClicked(clickOn(0));
    await flush();

    expect(partial).not.toHaveBeenCalled();
  });

  it('publishes the clicked entity when the popup asks it to', async () => {
    const store = makeStore(undefined);
    const { result } = renderHook(() =>
      useClickSync({ store: store as never, isReady: true, mappings: [site], confirm: true })
    );
    await flush();

    store.setClicked(clickOn(1));
    await flush();
    result.current.select();

    expect(partial).toHaveBeenCalledWith({ 'var-site': 'site-09' }, true);
  });

  it('leaves what the button published alone when the user clicks empty map', async () => {
    // The gesture that used to deselect now only closes the popup: dismissing
    // a popup must not reload the dashboard, which is the whole point of the
    // mode.
    const store = makeStore(undefined);
    const { result } = renderHook(() =>
      useClickSync({ store: store as never, isReady: true, mappings: [site], confirm: true })
    );
    await flush();

    store.setClicked(clickOn(0));
    await flush();
    result.current.select();
    search = new URLSearchParams({ 'var-site': 'site-07' });

    store.setClicked(null);
    await flush();

    expect(partial).toHaveBeenCalledTimes(1);
    expect(partial).toHaveBeenCalledWith({ 'var-site': 'site-07' }, true);
  });

  it('clears the selection when the popup asks it to', async () => {
    search = new URLSearchParams({ 'var-site': 'site-07' });
    const store = makeStore(clickOn(0));
    const { result } = renderHook(() =>
      useClickSync({ store: store as never, isReady: true, mappings: [site], confirm: true })
    );
    await flush();

    result.current.clear();

    expect(partial).toHaveBeenCalledWith({ 'var-site': '' }, true);
  });

  it('says whether the pinned entity is the one the variables hold', async () => {
    search = new URLSearchParams({ 'var-site': 'site-07' });
    const store = makeStore(clickOn(0));
    const { result } = renderHook(() =>
      useClickSync({ store: store as never, isReady: true, mappings: [site], confirm: true })
    );
    await flush();

    expect(result.current.isSelected()).toBe(true);

    store.setClicked(clickOn(1));
    await flush();

    expect(result.current.isSelected()).toBe(false);
  });
});
