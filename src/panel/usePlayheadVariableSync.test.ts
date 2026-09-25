import { renderHook } from '@testing-library/react';
import { BusEventWithPayload, EventBusSrv } from '@grafana/data';

import { DEFAULT_PUBLISH_INTERVAL_MS, formatTimeValue } from './timeVariableSync';
import { usePlayheadVariableSync } from './usePlayheadVariableSync';

/** Grafana's app event bus: the real class, so events match by type string as they do in Grafana. */
const mockBus = new EventBusSrv();

/** What the mocked adapter reads from kepler. A new `slice` object is a store change worth reacting to. */
const mockMap: { time: number | null; animating: boolean; slice: object } = {
  time: 0,
  animating: false,
  slice: {},
};

let mockSearch = new URLSearchParams();
/** Every write: when, which URL keys, and the value of `var-playhead`. */
const mockWrites: Array<{ at: number; keys: string[]; value: string }> = [];
/** Runs inside each write, as the panels a write sets off would. */
const mockOnWrite: Array<() => void> = [];

jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => mockBus,
  locationService: {
    partial: (query: Record<string, string>) => {
      const next = new URLSearchParams(mockSearch);
      for (const [key, value] of Object.entries(query)) {
        next.set(key, value);
      }
      mockSearch = next;
      mockWrites.push({ at: performance.now(), keys: Object.keys(query), value: query['var-playhead'] });
      mockOnWrite.slice().forEach((fn) => fn());
    },
    getSearch: () => mockSearch,
  },
}));

jest.mock('./keplerAdapter', () => ({
  readAnimationTime: () => mockMap.time,
  readIsAnimating: () => mockMap.animating,
  readSyncSlices: () => [mockMap.slice],
}));

/** The datasource's own class for its activity event: same type string, nothing imported from it. */
class DatasourceEvent extends BusEventWithPayload<{ state: 'busy' | 'settled'; at: number; pending: number }> {
  static type = 'ubica-duckdbwasm-activity';
}

function announce(state: 'busy' | 'settled'): void {
  mockBus.publish(new DatasourceEvent({ state, at: performance.now(), pending: state === 'busy' ? 1 : 0 }));
}

/** About one animation frame. */
const FRAME_MS = 16;
/** A frame on a starved main thread: longer than the 300 ms rest a moved-by-hand playhead waits for. */
const SLOW_FRAME_MS = 400;
/** One frame of playback moves the playhead this much. */
const STEP_MS = 1000;

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
    /** A new slice, which is what kepler hands back when the playhead or the play state changes. */
    touch: () => {
      mockMap.slice = {};
      subscribers.forEach((fn) => fn());
    },
  };
}

type FakeStore = ReturnType<typeof makeStore>;

function mount(variable = 'playhead', interval = 250) {
  const store = makeStore();
  const hook = renderHook(
    ({ name }: { name: string }) =>
      usePlayheadVariableSync({ store: store as never, isReady: true, variable: name, publishIntervalMs: interval }),
    { initialProps: { name: variable } }
  );
  return { store, hook };
}

/** Lets `ms` go by a frame at a time, moving the playhead a step each frame when `moving`. */
async function frames(store: FakeStore, ms: number, moving: boolean, frameMs = FRAME_MS): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += frameMs) {
    await jest.advanceTimersByTimeAsync(frameMs);
    if (moving && mockMap.time !== null) {
      mockMap.time += STEP_MS;
      store.touch();
    }
  }
}

function gapsSince(start: number): number[] {
  const times = mockWrites.filter((w) => w.at >= start).map((w) => w.at);
  return times.slice(1).map((at, i) => at - times[i]);
}

describe('usePlayheadVariableSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMap.time = 0;
    mockMap.animating = false;
    mockMap.slice = {};
    mockSearch = new URLSearchParams();
    mockWrites.length = 0;
    mockOnWrite.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes the playhead once on load, as UTC ISO 8601, and nothing more while still', async () => {
    const { store } = mount();
    await frames(store, 2000, false);
    expect(mockWrites).toHaveLength(1);
    expect(mockWrites[0].keys).toEqual(['var-playhead']);
    expect(mockWrites[0].value).toBe(formatTimeValue(0));
  });

  it('writes nothing when the option is empty', async () => {
    const { store } = mount('');
    mockMap.animating = true;
    await frames(store, 3000, true);
    expect(mockWrites).toHaveLength(0);
  });

  it('writes nothing until kepler has a playhead, then writes it', async () => {
    mockMap.time = null;
    const { store } = mount();
    await frames(store, 1000, false);
    expect(mockWrites).toHaveLength(0);
    mockMap.time = 5000;
    store.touch();
    await frames(store, 1000, false);
    expect(mockWrites.map((w) => w.value)).toEqual([formatTimeValue(5000)]);
  });

  it('while playing, writes once per interval with no datasource on the page', async () => {
    const { store } = mount('playhead', 250);
    await frames(store, 500, false);
    mockMap.animating = true;
    store.touch();
    const start = performance.now();
    await frames(store, 5000, true);
    const gaps = gapsSince(start);
    expect(gaps.length).toBeGreaterThanOrEqual(15);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(250);
      expect(gap).toBeLessThanOrEqual(250 + FRAME_MS);
    }
  });

  // 250 happens to equal PublishGate's own grace period, so a pacing bug that
  // drops the configured interval and falls back to the gate's grace alone
  // reads as correct there. A different interval isolates it — but only under
  // slow frames: at a smooth 16 ms per frame, the debounce that rearms on
  // every touch already lands the write at the interval boundary on its own,
  // so a bug confined to the hold check inside flush() (playbackWait) never
  // gets a chance to matter. Slower than the 300 ms rest, as
  // `useTimeVariableSync`'s equivalent test is, so the debounce fires early
  // and only that hold check keeps the pace to the interval.
  it('while playing, paces writes to the configured interval under slow frames, not the gate grace', async () => {
    const { store } = mount('playhead', 1000);
    await frames(store, 500, false);
    mockMap.animating = true;
    store.touch();
    const start = performance.now();
    await frames(store, 6000, true, SLOW_FRAME_MS);
    const gaps = gapsSince(start);
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(1000);
      expect(gap).toBeLessThanOrEqual(1000 + SLOW_FRAME_MS);
    }
  });

  it('while playing, holds a write until a busy datasource settles', async () => {
    const { store } = mount('playhead', 250);
    await frames(store, 500, false);
    mockMap.animating = true;
    store.touch();
    await frames(store, 300, true);
    // The next write sets the datasource working, and it does not settle for a second.
    mockOnWrite.push(() => setTimeout(() => announce('busy'), 20));
    const before = mockWrites.length;
    await frames(store, 300, true);
    expect(mockWrites.length).toBe(before + 1);
    mockOnWrite.length = 0;
    await frames(store, 1000, true);
    expect(mockWrites.length).toBe(before + 1);
    announce('settled');
    await frames(store, 50, true);
    expect(mockWrites.length).toBe(before + 2);
  });

  it('writes where the clock stopped, straight away, even inside the interval', async () => {
    const { store } = mount('playhead', 1500);
    await frames(store, 500, false);
    mockMap.animating = true;
    store.touch();
    await frames(store, 2000, true);
    const before = mockWrites.length;
    mockMap.animating = false;
    mockMap.time = 123_000;
    store.touch();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockWrites.length).toBe(before + 1);
    expect(mockWrites[mockWrites.length - 1].value).toBe(formatTimeValue(123_000));
  });

  it('moved by hand, writes once when it rests, not once per move', async () => {
    const { store } = mount();
    await frames(store, 500, false);
    const before = mockWrites.length;
    await frames(store, 400, true);
    expect(mockWrites.length).toBe(before);
    await frames(store, 400, false);
    expect(mockWrites.length).toBe(before + 1);
  });

  it('moved without rest and without playing (a peer drives it), still writes every 1.5 s', async () => {
    const { store } = mount();
    await frames(store, 500, false);
    const start = performance.now();
    await frames(store, 6000, true);
    const gaps = gapsSince(start);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(DEFAULT_PUBLISH_INTERVAL_MS - FRAME_MS);
      expect(gap).toBeLessThanOrEqual(DEFAULT_PUBLISH_INTERVAL_MS + FRAME_MS);
    }
  });

  it('never writes the same instant twice', async () => {
    const { store } = mount();
    await frames(store, 500, false);
    const before = mockWrites.length;
    for (let i = 0; i < 20; i++) {
      store.touch();
      await frames(store, 100, false);
    }
    expect(mockWrites.length).toBe(before);
  });

  // On load, or the moment kepler drops every animatable layer while rebuilding
  // a dataset's domain, `readAnimationTime` returns null outright (covered
  // separately above, on load). This is the same null, met mid-play: nothing
  // may be scheduled from it — in particular never a fabricated instant such
  // as 0 — and once a real instant returns, writing carries on from it.
  it('writes nothing while the domain has no playhead mid-play, and carries on once it returns', async () => {
    const { store } = mount('playhead', 250);
    await frames(store, 500, false);
    mockMap.animating = true;
    store.touch();
    await frames(store, 1000, true);
    // Let whatever the interval left in flight actually leave, so the count
    // sampled below is not the tail end of ordinary playback pacing.
    await frames(store, 800, false);
    const saved = mockMap.time;

    mockMap.time = null;
    store.touch();
    const before = mockWrites.length;
    await frames(store, 1000, false);
    expect(mockWrites.length).toBe(before);

    const recovered = (saved ?? 0) + 60_000;
    mockMap.time = recovered;
    store.touch();
    await frames(store, 1000, true);
    expect(mockWrites.length).toBeGreaterThan(before);
    expect(Date.parse(mockWrites[mockWrites.length - 1].value)).toBeGreaterThanOrEqual(recovered);
  });

  // kepler's own replace path (`updateAnimationDomain` in
  // vis-state-updaters.js) is not the null case above: it keeps `currentTime`
  // exactly where it was and only clears `isAnimating`. That is indistinguishable
  // from an ordinary stop, and must be handled the same way — the kept instant,
  // once, immediately — with playback picking back up at the interval pace
  // once the layer is animatable again.
  it('when a replace keeps the time and only clears isAnimating, writes that instant once and resumes after', async () => {
    const { store } = mount('playhead', 250);
    await frames(store, 500, false);
    mockMap.animating = true;
    store.touch();
    await frames(store, 1000, true);
    // One more advance that nothing has published yet, so the kept instant is
    // provably a fresh value rather than a coincidence with the last write.
    mockMap.time = (mockMap.time as number) + STEP_MS;
    const kept = mockMap.time as number;
    mockMap.animating = false;
    store.touch();
    const before = mockWrites.length;
    await jest.advanceTimersByTimeAsync(0);
    expect(mockWrites.length).toBe(before + 1);
    expect(mockWrites[mockWrites.length - 1].value).toBe(formatTimeValue(kept));

    mockMap.animating = true;
    store.touch();
    const start = performance.now();
    await frames(store, 2000, true);
    expect(gapsSince(start).length).toBeGreaterThanOrEqual(3);
  });

  it('stops writing to a variable the option no longer names', async () => {
    const { store, hook } = mount('playhead', 250);
    await frames(store, 500, false);
    mockMap.animating = true;
    store.touch();
    await frames(store, 1000, true);
    hook.rerender({ name: '' });
    const before = mockWrites.length;
    await frames(store, 3000, true);
    expect(mockWrites.length).toBe(before);
  });

  it('writes nothing after unmounting, even with a write pending', async () => {
    const { store, hook } = mount('playhead', 1500);
    await frames(store, 500, false);
    mockMap.animating = true;
    store.touch();
    await frames(store, 200, true);
    hook.unmount();
    const before = mockWrites.length;
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockWrites.length).toBe(before);
  });
});
