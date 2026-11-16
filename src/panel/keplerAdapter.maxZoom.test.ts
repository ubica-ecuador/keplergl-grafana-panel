import { registerEntry, updateMap, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { DEFAULT_MAX_ZOOM, KEPLER_INSTANCE_ID, maxZoomOf } from './constants';
import { keepMaxZoom, readMapState } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

function freshStore(): Store {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  return store;
}

const maxZoomIn = (store: Store) => (readMapState(store) as { maxZoom?: number } | null)?.maxZoom;

describe('maxZoomOf', () => {
  it('reads the option, 22 when unset, within 16 to 24', () => {
    expect(maxZoomOf(undefined)).toBe(DEFAULT_MAX_ZOOM);
    expect(DEFAULT_MAX_ZOOM).toBe(22);
    expect(maxZoomOf('')).toBe(22);
    expect(maxZoomOf('abc')).toBe(22);
    expect(maxZoomOf(24)).toBe(24);
    expect(maxZoomOf('23')).toBe(23);
    expect(maxZoomOf(30)).toBe(24);
    expect(maxZoomOf(3)).toBe(16);
  });
});

describe('keepMaxZoom', () => {
  it('puts the maximum zoom on the map state, past deck.gl’s 20', () => {
    const store = freshStore();
    const stop = keepMaxZoom(store, 24);
    expect(maxZoomIn(store)).toBe(24);
    // A zoom past deck.gl's own limit is kept.
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ zoom: 23 } as never, 0)) as never);
    expect(readMapState(store)?.zoom).toBe(23);
    stop();
  });

  it('holds it when the map state is replaced, and brings a map past it back', () => {
    const store = freshStore();
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ zoom: 23.5 } as never, 0)) as never);
    const stop = keepMaxZoom(store, 22);
    expect(maxZoomIn(store)).toBe(22);
    expect(readMapState(store)?.zoom).toBe(22);
    // What a saved config without one does to it.
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ maxZoom: 20 } as never, 0)) as never);
    expect(maxZoomIn(store)).toBe(22);
    stop();
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ maxZoom: 20 } as never, 0)) as never);
    expect(maxZoomIn(store)).toBe(20);
  });
});
