import { renderHook } from '@testing-library/react';

import { useVariableSync } from './useVariableSync';

const partial = jest.fn();
const listeners: Array<() => void> = [];
let search = new URLSearchParams();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    partial: (...args: unknown[]) => partial(...args),
    getSearch: () => search,
    getHistory: () => ({
      listen: (fn: () => void) => {
        listeners.push(fn);
        return () => {
          listeners.splice(listeners.indexOf(fn), 1);
        };
      },
    }),
  },
}));

/** The slice of kepler state the sync hook reads, and a store that serves it. */
function makeStore(filters: unknown[]) {
  let state = keplerState(filters);
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
    /** What kepler does on unmount: its entry disappears from the store. */
    dropEntry: () => {
      state = { keplerGl: {} };
      subscribers.forEach((fn) => fn());
    },
    /** Replaces parts of the vis state, as a kepler action would, and notifies. */
    setVisState: (patch: Record<string, unknown>) => {
      const entry = state.keplerGl.grafana as { visState: Record<string, unknown> };
      state = { keplerGl: { grafana: { ...entry, visState: { ...entry.visState, ...patch } } } };
      subscribers.forEach((fn) => fn());
    },
  };
}

function keplerState(filters: unknown[]): { keplerGl: Record<string, unknown> } {
  return {
    keplerGl: {
      grafana: {
        visState: { filters, datasets: {}, animationConfig: {}, editor: {} },
      },
    },
  };
}

const RANGE_MAPPING = [{ field: 'value', variable: 'minval', variableTo: 'maxval' }];

/** Runs the microtask the hook schedules its reconcile on. */
const flushMicrotasks = () => Promise.resolve().then(() => undefined);

/**
 * The unmount hazard, which is the whole reason this hook has a lifecycle test.
 *
 * kepler deletes its store entry as the panel unmounts, and that notification
 * reaches a subscriber that is still subscribed — the parent's effect cleanup
 * has not run yet. The reconcile it schedules therefore fires *after* teardown,
 * reads a map with no filters left, and reads that absence as "the user cleared
 * the filter", publishing blanks over variables nobody touched. Switching
 * dashboard tabs was enough to wipe the threshold slider's pair.
 */
describe('useVariableSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    partial.mockClear();
    listeners.length = 0;
    search = new URLSearchParams('var-minval=0&var-maxval=100');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not publish a cleared range once the panel has torn down', async () => {
    const store = makeStore([{ id: 'f1', type: 'range', name: ['value'], value: [0, 100] }]);
    const { unmount } = renderHook(() =>
      useVariableSync({ store: store as never, isReady: true, mappings: RANGE_MAPPING })
    );

    // First pass: map and variables already agree, so the pair is recorded as
    // the last agreement — which is what makes a later absence look like a
    // clearing.
    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    expect(partial).not.toHaveBeenCalled();

    store.dropEntry();
    unmount();
    await flushMicrotasks();
    jest.advanceTimersByTime(500);

    expect(partial).not.toHaveBeenCalled();
  });

  it('still publishes a range the user clears while the panel is alive', async () => {
    const store = makeStore([{ id: 'f1', type: 'range', name: ['value'], value: [0, 100] }]);
    renderHook(() => useVariableSync({ store: store as never, isReady: true, mappings: RANGE_MAPPING }));

    await flushMicrotasks();
    jest.advanceTimersByTime(500);
    partial.mockClear();

    store.dropEntry();
    await flushMicrotasks();
    jest.advanceTimersByTime(500);

    expect(partial).toHaveBeenCalledWith({ 'var-minval': '', 'var-maxval': '' }, true);
  });
});

/**
 * The refresh hazard. Replacing a dataset — every refresh of the panel's
 * queries — takes its filters off the map and parks them in `filterToBeMerged`
 * until the new rows land. Read in that window, a mapped field has no filter,
 * and that used to be taken for the user clearing it: the variable was reset to
 * All, and put back a moment later when the filter returned. When the map's own
 * queries read that variable, each of those writes refreshed the map again, and
 * the variable flipped for ever (measured on trimet-live and gtfs-rt-mbta).
 */
describe('useVariableSync across a refresh', () => {
  const ROUTE_MAPPING = [{ field: 'route', variable: 'route' }];
  const routeFilter = {
    id: 'f1',
    type: 'multiSelect',
    name: ['route'],
    dataId: ['grafana-A'],
    value: ['MAX Blue Line'],
  };
  const vehicles = { 'grafana-A': { id: 'grafana-A', fields: [{ name: 'route' }, { name: 'value' }] } };

  beforeEach(() => {
    jest.useFakeTimers();
    partial.mockClear();
    listeners.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function settle() {
    await flushMicrotasks();
    jest.advanceTimersByTime(500);
  }

  it('leaves a scalar variable alone while its filter waits for the new rows', async () => {
    search = new URLSearchParams('var-route=MAX Blue Line');
    const store = makeStore([routeFilter]);
    store.setVisState({ datasets: vehicles, filterToBeMerged: [] });
    renderHook(() => useVariableSync({ store: store as never, isReady: true, mappings: ROUTE_MAPPING }));
    await settle();
    expect(partial).not.toHaveBeenCalled();

    store.setVisState({ filters: [], datasets: {}, filterToBeMerged: [routeFilter] });
    await settle();
    store.setVisState({ filters: [routeFilter], datasets: vehicles, filterToBeMerged: [] });
    await settle();

    expect(partial).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('leaves a range pair alone while its filter waits for the new rows', async () => {
    search = new URLSearchParams('var-minval=0&var-maxval=100');
    const range = { id: 'f2', type: 'range', name: ['value'], dataId: ['grafana-A'], value: [0, 100] };
    const store = makeStore([range]);
    store.setVisState({ datasets: vehicles, filterToBeMerged: [] });
    renderHook(() => useVariableSync({ store: store as never, isReady: true, mappings: RANGE_MAPPING }));
    await settle();

    store.setVisState({ filters: [], datasets: {}, filterToBeMerged: [range] });
    await settle();

    expect(partial).not.toHaveBeenCalled();
  });

  it('still publishes All when the filter is removed from the map', async () => {
    search = new URLSearchParams('var-route=MAX Blue Line');
    const store = makeStore([routeFilter]);
    store.setVisState({ datasets: vehicles, filterToBeMerged: [] });
    renderHook(() => useVariableSync({ store: store as never, isReady: true, mappings: ROUTE_MAPPING }));
    await settle();

    store.setVisState({ filters: [] });
    await settle();

    expect(partial).toHaveBeenCalledWith({ 'var-route': '$__all' }, true);
  });

  it('does not let a filter kepler could not merge block its field for good', async () => {
    // kepler also parks a filter it failed to validate — on a dataset that is
    // loaded, and there it stays. That is no refresh in progress: the variable
    // must still drive the map.
    search = new URLSearchParams('var-route=MAX Blue Line');
    const store = makeStore([]);
    store.setVisState({ datasets: vehicles, filterToBeMerged: [{ ...routeFilter, value: ['old'] }] });
    renderHook(() => useVariableSync({ store: store as never, isReady: true, mappings: ROUTE_MAPPING }));
    await settle();

    expect(store.dispatch).toHaveBeenCalled();
  });
});
