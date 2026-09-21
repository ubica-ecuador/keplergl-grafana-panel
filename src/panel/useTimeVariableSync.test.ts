import { renderHook } from '@testing-library/react';
import { BusEventWithPayload, EventBusSrv } from '@grafana/data';

import { DEFAULT_PUBLISH_INTERVAL_MS, formatTimeValue } from './timeVariableSync';
import type { TimeRangeMs } from './timeSync';
import { useTimeVariableSync } from './useTimeVariableSync';

/** Grafana's app event bus: the real class, so events match by type string as they do in Grafana. */
const mockBus = new EventBusSrv();

/** What the mocked adapter reads from kepler. A new `filters` object is a store change worth reacting to. */
const mockMap: { window: TimeRangeMs; animating: boolean; filters: object } = {
  window: { from: 0, to: 60_000 },
  animating: false,
  filters: {},
};
/** What the peer channel says about the other maps. */
const mockPeers = { playing: false };

let mockSearch = new URLSearchParams();
const mockHistoryListeners: Array<() => void> = [];
/** Runs inside each write, as the panels a write sets off would. */
const mockOnWrite: Array<() => void> = [];
/** Every write of the variables: when, and the window's start it carried. */
const mockWrites: Array<{ at: number; from: number }> = [];

jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => mockBus,
  locationService: {
    partial: (query: Record<string, string>) => {
      const next = new URLSearchParams(mockSearch);
      for (const [key, value] of Object.entries(query)) {
        next.set(key, value);
      }
      mockSearch = next;
      mockWrites.push({ at: performance.now(), from: Date.parse(query['var-mapFrom']) });
      mockOnWrite.slice().forEach((fn) => fn());
      mockHistoryListeners.slice().forEach((fn) => fn());
    },
    getSearch: () => mockSearch,
    getHistory: () => ({
      listen: (fn: () => void) => {
        mockHistoryListeners.push(fn);
        return () => {
          mockHistoryListeners.splice(mockHistoryListeners.indexOf(fn), 1);
        };
      },
    }),
  },
}));

jest.mock('./keplerAdapter', () => ({
  ensureTimeFilter: () => true,
  isTimeFilterAnimating: () => mockMap.animating,
  pushTimeRange: (_store: unknown, _dispatch: unknown, window: TimeRangeMs) => {
    mockMap.window = window;
    return true;
  },
  readSyncSlices: () => [mockMap.filters],
  readTimeDomain: () => ({ from: 0, to: 100_000_000 }),
  readTimeRange: () => mockMap.window,
}));

jest.mock('./timeChannel', () => ({ timeChannel: { anyPlaying: () => mockPeers.playing } }));

/** The datasource's own class for its activity event: same type string, nothing imported from it. */
class DatasourceEvent extends BusEventWithPayload<{ state: 'busy' | 'settled'; at: number; pending: number }> {
  static type = 'ubica-duckdbwasm-activity';
}

/** Another plugin's event on the same type string, keeping none of the contract. */
class ForeignEvent extends BusEventWithPayload<unknown> {
  static type = 'ubica-duckdbwasm-activity';
}

const MAPPING = { from: 'mapFrom', to: 'mapTo' };

/** About one animation frame. */
const FRAME_MS = 16;

/** What the datasource says as it starts answering, or once it has nothing left. */
function announce(state: 'busy' | 'settled'): void {
  mockBus.publish(new DatasourceEvent({ state, at: performance.now(), pending: state === 'busy' ? 1 : 0 }));
}

/** Runs `fn` inside the next write only. */
function onNextWrite(fn: () => void): void {
  const once = () => {
    mockOnWrite.splice(mockOnWrite.indexOf(once), 1);
    fn();
  };
  mockOnWrite.push(once);
}

function makeStore() {
  const subscribers: Array<() => void> = [];
  return {
    getState: () => ({}),
    dispatch: jest.fn(),
    subscribe: (fn: () => void) => {
      subscribers.push(fn);
      return () => {
        subscribers.splice(subscribers.indexOf(fn), 1);
      };
    },
    /** A new filters slice, which is what kepler hands back when the window or the play state changes. */
    touch: () => {
      mockMap.filters = {};
      subscribers.forEach((fn) => fn());
    },
  };
}

type FakeStore = ReturnType<typeof makeStore>;

function mount(interval: number, peerSync = false) {
  const store = makeStore();
  renderHook(() =>
    useTimeVariableSync({
      store: store as never,
      isReady: true,
      enabled: true,
      mapping: MAPPING,
      whilePlaying: true,
      publishIntervalMs: interval,
      peerSync,
    })
  );
  return store;
}

/** Lets `ms` go by a frame at a time, moving the window one step each frame when `moving`. */
async function frames(store: FakeStore, ms: number, moving: boolean): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
    await jest.advanceTimersByTimeAsync(FRAME_MS);
    if (moving) {
      mockMap.window = { from: mockMap.window.from + 1000, to: mockMap.window.to + 1000 };
      store.touch();
    }
  }
}

function writesSince(start: number) {
  return mockWrites.filter((write) => write.at >= start);
}

/** The time between consecutive writes from `start` on. */
function gapsSince(start: number): number[] {
  const times = writesSince(start).map((write) => write.at);
  return times.slice(1).map((at, i) => at - times[i]);
}

/** Mounts a map whose variables already agree with it, lets the first pass settle, and starts its clock. */
async function playing({ interval, peer = false }: { interval: number; peer?: boolean }): Promise<FakeStore> {
  const store = mount(interval, peer);
  await frames(store, 50, false);
  if (peer) {
    mockPeers.playing = true;
  } else {
    mockMap.animating = true;
  }
  await frames(store, 600, true);
  return store;
}

/**
 * Plays until the next write, has the datasource turn busy 20 ms after it and
 * never settle, and plays on while that holds. Returns the writes made so far.
 */
async function holdOnBusy(store: FakeStore): Promise<number> {
  onNextWrite(() => setTimeout(() => announce('busy'), 20));
  await frames(store, 300, true);
  const held = mockWrites.length;
  await frames(store, 700, true);
  expect(mockWrites).toHaveLength(held);
  return held;
}

/**
 * How often the map writes its window with publishing while playing on, on a
 * fake clock: frames of 16 ms, each moving the window a step, and a datasource
 * that is either absent or announces itself on a real event bus. What it pins
 * is the pace at the default and the minimum with no datasource, the hold on a
 * busy one, the final window after a stop, and a drag's debounce.
 */
describe('useTimeVariableSync, with publishing while playing on', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMap.window = { from: 0, to: 60_000 };
    mockMap.animating = false;
    mockMap.filters = {};
    mockPeers.playing = false;
    mockHistoryListeners.length = 0;
    mockOnWrite.length = 0;
    mockWrites.length = 0;
    mockSearch = new URLSearchParams({ 'var-mapFrom': formatTimeValue(0), 'var-mapTo': formatTimeValue(60_000) });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('with no datasource announcing its activity', () => {
    it('writes once every interval at the default, as before the option existed', async () => {
      const store = await playing({ interval: DEFAULT_PUBLISH_INTERVAL_MS });
      const start = performance.now();
      await frames(store, 10_000, true);

      const gaps = gapsSince(start);
      expect(gaps.length).toBeGreaterThanOrEqual(5);
      for (const gap of gaps) {
        // Measured from the first change after a write, which comes up to a frame later.
        expect(gap).toBeGreaterThanOrEqual(DEFAULT_PUBLISH_INTERVAL_MS);
        expect(gap).toBeLessThanOrEqual(DEFAULT_PUBLISH_INTERVAL_MS + FRAME_MS);
      }
    });

    it('writes once every interval at the minimum', async () => {
      const store = await playing({ interval: 250 });
      const start = performance.now();
      await frames(store, 3000, true);

      const gaps = gapsSince(start);
      expect(gaps.length).toBeGreaterThanOrEqual(10);
      for (const gap of gaps) {
        expect(gap).toBeGreaterThanOrEqual(250);
        expect(gap).toBeLessThanOrEqual(250 + FRAME_MS);
      }
    });

    it('keeps that pace when events on the same type do not keep the contract', async () => {
      const store = await playing({ interval: 250 });
      // Where a busy would come: shortly after a write, inside the grace.
      onNextWrite(() =>
        setTimeout(() => {
          mockBus.publish({ type: 'ubica-duckdbwasm-activity' });
          mockBus.publish({ type: 'ubica-duckdbwasm-activity', payload: null });
          mockBus.publish(new ForeignEvent({ state: 'other', at: performance.now(), pending: 0 }));
          mockBus.publish(new ForeignEvent({ state: 'busy', at: undefined, pending: 1 }));
          mockBus.publish(new ForeignEvent({ state: 'busy', at: Number.NaN, pending: 1 }));
          mockBus.publish(new ForeignEvent({ state: 'busy', at: String(performance.now()), pending: 1 }));
        }, 20)
      );
      const start = performance.now();
      await frames(store, 2000, true);

      const gaps = gapsSince(start);
      expect(gaps.length).toBeGreaterThanOrEqual(6);
      for (const gap of gaps) {
        expect(gap).toBeGreaterThanOrEqual(250);
        expect(gap).toBeLessThanOrEqual(250 + FRAME_MS);
      }
    });
  });

  describe('with a datasource announcing its activity', () => {
    it('holds a step while the panels are busy, and writes only the newest window once they settle', async () => {
      const store = await playing({ interval: 250 });
      const held = await holdOnBusy(store);

      announce('settled');
      const settledAt = performance.now();
      await jest.advanceTimersByTimeAsync(0);
      expect(mockWrites).toHaveLength(held + 1);
      expect(mockWrites[held]).toEqual({ at: settledAt, from: mockMap.window.from });

      // The steps skipped while held are gone, not queued behind it.
      await frames(store, 200, true);
      expect(mockWrites).toHaveLength(held + 1);
    });

    it('counts a busy announced during the write itself', async () => {
      const store = await playing({ interval: 250 });
      onNextWrite(() => announce('busy'));
      await frames(store, 300, true);
      const held = mockWrites.length;
      await frames(store, 1000, true);

      expect(mockWrites).toHaveLength(held);
    });

    it('writes the final window within the rest delay of a local stop while held', async () => {
      const store = await playing({ interval: 250 });
      const held = await holdOnBusy(store);

      // kepler's pause: the filter stops animating and the window stays put.
      mockMap.animating = false;
      store.touch();
      const stoppedAt = performance.now();
      await frames(store, 300, false);

      expect(mockWrites).toHaveLength(held + 1);
      expect(mockWrites[held].from).toBe(mockMap.window.from);
      expect(mockWrites[held].at - stoppedAt).toBeLessThanOrEqual(300);
    });

    it("writes the final window within the rest delay of a peer's stop while held", async () => {
      const store = await playing({ interval: 250, peer: true });
      const held = await holdOnBusy(store);

      // The peer's stop reaches the channel only: this store hears nothing.
      mockPeers.playing = false;
      const stoppedAt = performance.now();
      await frames(store, 300, false);

      expect(mockWrites).toHaveLength(held + 1);
      expect(mockWrites[held].from).toBe(mockMap.window.from);
      expect(mockWrites[held].at - stoppedAt).toBeLessThanOrEqual(300);
    });
  });

  describe('a drag', () => {
    it('writes once, 300 ms after the last move, whatever the interval', async () => {
      const store = mount(250);
      await frames(store, 50, false);
      const start = performance.now();
      await frames(store, 500, true);
      const lastMove = performance.now();
      await frames(store, 1000, false);

      expect(writesSince(start)).toEqual([{ at: lastMove + 300, from: mockMap.window.from }]);
    });

    it('that never rests still writes every 1.5 s, as before the option existed', async () => {
      const store = mount(250);
      await frames(store, 50, false);
      const start = performance.now();
      await frames(store, 4000, true);
      const lastMove = performance.now();
      await frames(store, 1000, false);

      const writes = writesSince(start);
      expect(writes).toHaveLength(3);
      const [first, second, last] = writes;
      expect(first.at - start).toBeLessThanOrEqual(DEFAULT_PUBLISH_INTERVAL_MS + FRAME_MS);
      expect(second.at - first.at).toBeGreaterThanOrEqual(DEFAULT_PUBLISH_INTERVAL_MS);
      expect(second.at - first.at).toBeLessThanOrEqual(DEFAULT_PUBLISH_INTERVAL_MS + FRAME_MS);
      expect(last).toEqual({ at: lastMove + 300, from: mockMap.window.from });
    });
  });
});
