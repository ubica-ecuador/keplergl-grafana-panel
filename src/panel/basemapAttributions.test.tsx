import { getBaseMapAttributions } from '@kepler.gl/utils';

import { collectEveryBasemapAttribution, type AttributionHost, type AttributionMap } from './basemapAttributions';

type Listener = (event?: { isSourceLoaded?: boolean; sourceDataType?: string }) => void;

/** A MapLibre map whose sources get their attribution when the test says so. */
function fakeMap() {
  const listeners: Record<string, Listener[]> = {};
  const sources: Record<string, { attribution?: string }> = {};
  const map = {
    on: (type: string, listener: Listener) => (listeners[type] = [...(listeners[type] ?? []), listener]),
    off: (type: string, listener: Listener) =>
      (listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener)),
    getStyle: () => ({ sources: Object.fromEntries(Object.keys(sources).map((id) => [id, {}])) }),
    getSource: (id: string) => sources[id],
    emit: (type: string, event?: Parameters<Listener>[0]) => (listeners[type] ?? []).forEach((l) => l(event)),
    listening: () => Object.values(listeners).reduce((n, list) => n + list.length, 0),
    sources,
  };
  return map;
}

/** kepler's MapContainer as far as the collector sees it, with kepler's own first-found collector. */
function fakeHost(map: ReturnType<typeof fakeMap>) {
  const host: AttributionHost & { state: { basemapAttributions?: string[] } } = {
    _map: map as unknown as AttributionMap,
    state: {},
    setState(update) {
      host.state = { ...host.state, ...update };
    },
    _removeBasemapAttributionListeners() {
      if (host._basemapSourceDataListener) {
        map.off('sourcedata', host._basemapSourceDataListener);
        host._basemapSourceDataListener = null;
      }
      if (host._basemapIdleListener) {
        map.off('idle', host._basemapIdleListener);
        host._basemapIdleListener = null;
      }
    },
    // kepler's: stops at the first event that yields any attribution.
    _collectBasemapAttributions() {
      const onSourceData: Listener = () => {
        const found = getBaseMapAttributions(map as never);
        if (found.length) {
          host._removeBasemapAttributionListeners!();
          host.setState!({ basemapAttributions: found });
        }
      };
      host._basemapSourceDataListener = onSourceData;
      map.on('sourcedata', onSourceData);
    },
  };
  return host;
}

const OSM = '© OpenStreetMap contributors';
const OPEN_WATERS = '© Open Waters: Seamap © OpenStreetMap contributors';
const SEASCAPE = '© Open Waters';

/** Seamap's case: one source credited in the style, two more by their TileJSON, later. */
function loadSeamap(map: ReturnType<typeof fakeMap>, host: AttributionHost) {
  map.sources['versatiles-shortbread'] = { attribution: OSM };
  map.sources.seamap = {};
  map.sources['seascape-dem'] = {};
  host._collectBasemapAttributions!();
  map.emit('sourcedata', { sourceDataType: 'metadata' });
  map.sources.seamap.attribution = OPEN_WATERS;
  map.emit('sourcedata', { sourceDataType: 'metadata' });
  map.sources['seascape-dem'].attribution = SEASCAPE;
  map.emit('sourcedata', { isSourceLoaded: true });
}

describe('the base map attribution', () => {
  it("is cut short by kepler's own collector, which stops at the first source credited", () => {
    const map = fakeMap();
    const host = fakeHost(map);
    loadSeamap(map, host);
    expect(host.state.basemapAttributions).toEqual([OSM]);
  });

  it("credits every source once the panel's collector stands in", () => {
    const map = fakeMap();
    const host = fakeHost(map);
    collectEveryBasemapAttribution(host);
    loadSeamap(map, host);
    expect(host.state.basemapAttributions).toEqual([OSM, OPEN_WATERS, SEASCAPE]);
  });

  it('stops listening once the map is idle', () => {
    const map = fakeMap();
    const host = fakeHost(map);
    collectEveryBasemapAttribution(host);
    loadSeamap(map, host);
    expect(map.listening()).toBe(2);
    map.emit('idle');
    expect(map.listening()).toBe(0);
  });

  it('collects again when the map switches base map, from a clean slate of listeners', () => {
    const map = fakeMap();
    const host = fakeHost(map);
    collectEveryBasemapAttribution(host);
    host._collectBasemapAttributions!();
    host._collectBasemapAttributions!();
    expect(map.listening()).toBe(2);
  });

  it('ignores events that carry no new metadata, and never empties the list', () => {
    const map = fakeMap();
    const host = fakeHost(map);
    collectEveryBasemapAttribution(host);
    host.state.basemapAttributions = [OSM];
    host._collectBasemapAttributions!();
    map.emit('sourcedata', { sourceDataType: 'metadata' });
    expect(host.state.basemapAttributions).toEqual([OSM]);
    const setState = jest.spyOn(host, 'setState');
    map.sources.a = { attribution: OSM };
    map.emit('sourcedata', { sourceDataType: 'content' });
    map.emit('sourcedata', { sourceDataType: 'metadata' });
    expect(setState).not.toHaveBeenCalled();
  });

  it('leaves alone a container without kepler’s methods, and patches each one once', () => {
    const bare = { setState: jest.fn() } as AttributionHost;
    collectEveryBasemapAttribution(bare);
    expect(bare._collectBasemapAttributions).toBeUndefined();

    const map = fakeMap();
    const host = fakeHost(map);
    collectEveryBasemapAttribution(host);
    const patched = host._collectBasemapAttributions;
    collectEveryBasemapAttribution(host);
    expect(host._collectBasemapAttributions).toBe(patched);
  });
});
