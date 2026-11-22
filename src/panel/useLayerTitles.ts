import type { DataFrame } from '@grafana/data';
import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { KEPLER_INSTANCE_ID } from './constants';
import { applyLayerTitles } from './keplerAdapter';
import { type WantedTitle, wantedTitles } from './layerTitles';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The panel's frames: which of them name their layer's title (`meta.custom.layer.title`). */
  frames: readonly DataFrame[];
}

/**
 * Names the map's layers as their data source names them (`layerTitles.ts`).
 *
 * kepler makes a query's layers through tasks of its own, after the rows are
 * handed over, and a query pointed at another layer keeps its layers: so the
 * names are checked on store changes, as the sibling hooks do, and only while
 * kepler's layer list is a new one. The dispatch happens on a microtask, never
 * inside the store subscription.
 */
export function useLayerTitles({ store, isReady, frames }: Params): void {
  /** Per refId, the titles its frames have named, so that a layer named after an earlier one is renamed too. */
  const named = useRef(new Map<string, string[]>());
  const wanted = useRef<Map<string, WantedTitle>>(new Map());
  /** kepler's layer list last checked: an unchanged list has nothing new to name. */
  const checked = useRef<unknown>(null);

  const pending = useRef(false);
  const schedule = useRef(() => {
    if (pending.current || wanted.current.size === 0) {
      return;
    }
    const state = store.getState() as { keplerGl?: Record<string, { visState?: { layers?: unknown } }> };
    const layers = state.keplerGl?.[KEPLER_INSTANCE_ID]?.visState?.layers;
    if (!layers || layers === checked.current) {
      return;
    }
    pending.current = true;
    void Promise.resolve().then(() => {
      pending.current = false;
      checked.current = layers;
      applyLayerTitles(store, store.dispatch, wanted.current);
    });
  });

  useEffect(() => {
    const next = wantedTitles(frames, named.current);
    named.current = next.named;
    wanted.current = next.wanted;
    // New titles: kepler's present layers are checked again.
    checked.current = null;
    if (isReady) {
      schedule.current();
    }
  }, [frames, isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    schedule.current();
    return store.subscribe(schedule.current);
  }, [isReady, store]);
}
