import { renderHook } from '@testing-library/react';
import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry, setFilterAnimationTime, toggleFilterAnimation, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToDatasets, type PanelDataset } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import {
  capturePlayingTimeFilter,
  ensureTimeFilter,
  loadDatasets,
  pushTimeRange,
  refreshDatasets,
  resumeTimeFilter,
} from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { formatTimeValue } from './timeVariableSync';
import { useTimeVariableSync } from './useTimeVariableSync';

let mockSearch = new URLSearchParams();
/** Every write of the time variables. */
const mockWrites: Array<Record<string, string>> = [];

jest.mock('@grafana/runtime', () => {
  const { EventBusSrv } = jest.requireActual('@grafana/data');
  const bus = new EventBusSrv();
  return {
    getAppEvents: () => bus,
    locationService: {
      partial: (query: Record<string, string>) => {
        mockWrites.push(query);
        const next = new URLSearchParams(mockSearch);
        for (const [key, value] of Object.entries(query)) {
          next.set(key, value);
        }
        mockSearch = next;
      },
      getSearch: () => mockSearch,
      getHistory: () => ({ listen: () => () => undefined }),
    },
  };
});

/** kepler's data pipeline settles on the task middleware's promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const HOUR = 3_600_000;
const START = Date.parse('2026-09-01T00:00:00Z');
/** The data's time domain: twelve hourly rows. */
const DOMAIN: [number, number] = [START, START + 11 * HOUR];
/** A window inside the domain, as a drag leaves it. */
const NARROWED: [number, number] = [START + 2 * HOUR, START + 5 * HOUR];
/** A window whose end runs past the domain's, as a playing window does near the end. */
const STICKING_OUT: [number, number] = [START + 8 * HOUR, START + 14 * HOUR];

/** One query's answer: hourly points, as Grafana hands them to the panel. */
function answer(refId: string, shift = 0): PanelDataset {
  const times = Array.from({ length: 12 }, (_, i) => START + i * HOUR);
  const [dataset] = framesToDatasets([
    toDataFrame({
      refId,
      fields: [
        { name: 'time', type: FieldType.time, values: times },
        { name: 'latitude', type: FieldType.number, values: times.map((_, i) => -2.9 + i * 0.001 + shift) },
        { name: 'longitude', type: FieldType.number, values: times.map(() => -79) },
      ],
    }),
  ]);
  return dataset;
}

interface TimeFilter {
  id: string;
  value: [number, number];
  isAnimating?: boolean;
}

function visStateOf(store: Store) {
  return (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState;
}

function timeFilter(store: Store): TimeFilter | undefined {
  return visStateOf(store).filters.find((f: { type?: string }) => f.type === 'timeRange');
}

function timeFilterIndex(store: Store): number {
  return visStateOf(store).filters.findIndex((f: { type?: string }) => f.type === 'timeRange');
}

/** A map showing `datasets`, with a time filter on the first, set to `value`. */
async function mapWithTimeFilter(datasets: PanelDataset[], value: [number, number]): Promise<Store> {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  loadDatasets(store.dispatch, datasets);
  await settle();
  expect(ensureTimeFilter(store, store.dispatch)).toBe(true);
  await settle();
  expect(pushTimeRange(store, store.dispatch, { from: DOMAIN[0], to: DOMAIN[1] })).toBe(true);
  await settle();
  // Set the way an animation frame sets it, which is also the only way a window
  // can stick out past the domain: kepler clamps everything else.
  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, setFilterAnimationTime(timeFilterIndex(store), 'value', value)) as never);
  await settle();
  expect(timeFilter(store)?.value).toEqual(value);
  return store;
}

/** What the play button sends. */
function play(store: Store): void {
  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, toggleFilterAnimation(timeFilterIndex(store))) as never);
  expect(timeFilter(store)?.isAnimating).toBe(true);
}

/**
 * The refresh branch of the load effect in `KeplerMap.tsx`. Returns what stops
 * the resume, which the branch keeps for a rebuild or an unmount to call.
 */
function refresh(store: Store, datasets: PanelDataset[], giveUpMs?: number): () => void {
  const playing = capturePlayingTimeFilter(store, datasets);
  refreshDatasets(store, store.dispatch, datasets);
  return playing ? resumeTimeFilter(store, store.dispatch, playing, giveUpMs) : () => undefined;
}

describe('a data refresh while the time filter plays', () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams();
    mockWrites.length = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps it playing, on the window it had', async () => {
    const store = await mapWithTimeFilter([answer('A')], NARROWED);
    const { id } = timeFilter(store)!;
    play(store);

    refresh(store, [answer('A', 0.01)]);
    await settle();

    expect(timeFilter(store)).toMatchObject({ id, isAnimating: true, value: NARROWED });
  });

  it('puts back a window kepler clamped to the domain', async () => {
    const store = await mapWithTimeFilter([answer('A'), answer('B')], STICKING_OUT);
    const { id } = timeFilter(store)!;
    play(store);

    refresh(store, [answer('A', 0.01), answer('B', 0.01)]);
    await settle();

    expect(timeFilter(store)).toMatchObject({ id, isAnimating: true, value: STICKING_OUT });
  });

  // The investigation's S5: the clamped window read as a local change and went
  // out to the dashboard once, one more round of queries for every panel.
  it('publishes no clamped window to the dashboard', async () => {
    const store = await mapWithTimeFilter([answer('A')], STICKING_OUT);
    play(store);
    // The variables already hold the window, as they do once it was published.
    mockSearch = new URLSearchParams({
      'var-mapFrom': formatTimeValue(STICKING_OUT[0]),
      'var-mapTo': formatTimeValue(STICKING_OUT[1]),
    });
    const { unmount } = renderHook(() =>
      useTimeVariableSync({
        store,
        isReady: true,
        enabled: true,
        mapping: { from: 'mapFrom', to: 'mapTo' },
        whilePlaying: true,
        publishIntervalMs: 1500,
        peerSync: false,
      })
    );
    await settle();
    expect(mockWrites).toEqual([]);

    refresh(store, [answer('A', 0.01)]);
    await settle();
    // Past the 300 ms a paused window rests before it is published.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(mockWrites).toEqual([]);
    unmount();
  });

  it('leaves a paused one paused', async () => {
    const store = await mapWithTimeFilter([answer('A')], NARROWED);
    const { id } = timeFilter(store)!;

    expect(capturePlayingTimeFilter(store, [answer('A', 0.01)])).toBeNull();
    refresh(store, [answer('A', 0.01)]);
    await settle();

    expect(timeFilter(store)).toMatchObject({ id, isAnimating: false, value: NARROWED });
  });

  it('does not watch when the refresh leaves the filtered dataset alone', async () => {
    const store = await mapWithTimeFilter([answer('A')], NARROWED);
    play(store);

    // A query that gained a refId: B is added, A is not replaced.
    expect(capturePlayingTimeFilter(store, [answer('B')])).toBeNull();
    expect(capturePlayingTimeFilter(store, [answer('A', 0.01), answer('B')])).not.toBeNull();
  });

  // What the rebuild branch does to a resume a refresh left pending: a new
  // config is not the map the filter was playing on.
  it('does not resume once stopped, as a rebuild stops it', async () => {
    const store = await mapWithTimeFilter([answer('A')], STICKING_OUT);
    play(store);

    const { id } = timeFilter(store)!;
    const stop = refresh(store, [answer('A', 0.01)]);
    stop();
    loadDatasets(store.dispatch, [answer('A', 0.02)]);
    await settle();

    expect(timeFilter(store)).toMatchObject({ id, isAnimating: false });
  });

  it('gives up without throwing when the filter never comes back', async () => {
    // kepler says why it cannot rebuild the filter; that is the point here.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = await mapWithTimeFilter([answer('A')], NARROWED);
    const { id } = timeFilter(store)!;
    play(store);
    const { time: _time, ...withoutTime } = answer('A', 0.01).rows[0];
    const noTime: PanelDataset = { ...answer('A', 0.01), rows: [withoutTime] };

    // No time column left to rebuild the filter on, so it stays parked.
    refresh(store, [noTime], 50);
    await settle();
    expect(timeFilter(store)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The time column is back after the watch gave up: the filter returns as
    // kepler rebuilds it, and nothing presses play on it any more.
    const listener = jest.fn();
    store.subscribe(listener);
    refreshDatasets(store, store.dispatch, [answer('A', 0.02)]);
    await settle();
    expect(listener).toHaveBeenCalled();
    expect(timeFilter(store)).toMatchObject({ id, isAnimating: false });
  });
});
