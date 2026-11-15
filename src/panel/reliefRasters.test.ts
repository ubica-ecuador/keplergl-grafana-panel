import { xyzMapLibreTemplate } from '../data/xyzTiles';
import {
  absoluteTemplate,
  NATIVE_PREFIX,
  type NativeRaster,
  nativeRasterOf,
  type RasterMap,
  splitNativeRasters,
  syncNativeRasters,
} from './reliefRasters';

/** MapLibre's style, as far as the panel's raster layers go: sources, layers in order, paint and layout. */
class FakeRasterMap implements RasterMap {
  sources = new Map<string, { options: Record<string, unknown>; setTiles: jest.Mock; serialize(): any }>();
  layers: Array<{ id: string; paint: Record<string, unknown>; layout: Record<string, unknown> }> = [];
  loaded = true;
  added: string[] = [];
  moved: string[] = [];

  constructor(baseLayers: string[] = []) {
    this.layers = baseLayers.map((id) => ({ id, paint: {}, layout: {} }));
  }

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: Record<string, unknown>) {
    if (!this.loaded) {
      throw new Error('Style is not done loading.');
    }
    const source = {
      options: { ...spec },
      setTiles: jest.fn((tiles: string[]) => {
        source.options.tiles = tiles;
      }),
      serialize: () => source.options,
    };
    this.sources.set(id, source);
    this.added.push(id);
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.layers.find((layer) => layer.id === id);
  }
  addLayer(layer: Record<string, any>) {
    this.layers.push({ id: layer.id, paint: { ...layer.paint }, layout: { ...layer.layout } });
  }
  removeLayer(id: string) {
    this.layers = this.layers.filter((layer) => layer.id !== id);
  }
  moveLayer(id: string) {
    const layer = this.getLayer(id)!;
    this.removeLayer(id);
    this.layers.push(layer);
    this.moved.push(id);
  }
  getLayersOrder() {
    return this.layers.map((layer) => layer.id);
  }
  getPaintProperty(id: string, name: string) {
    return this.getLayer(id)?.paint[name];
  }
  setPaintProperty(id: string, name: string, value: unknown) {
    this.getLayer(id)!.paint[name] = value;
  }
  getLayoutProperty(id: string, name: string) {
    return this.getLayer(id)?.layout[name];
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    this.getLayer(id)!.layout[name] = value;
  }
}

const raster = (id: string, more: Partial<NativeRaster> = {}): NativeRaster => ({
  id,
  tiles: [`https://tiles.example/${id}/{z}/{x}/{y}.png`],
  scheme: 'xyz',
  tileSize: 256,
  minzoom: 0,
  opacity: 1,
  visible: true,
  ...more,
});

describe('xyzMapLibreTemplate', () => {
  it('keeps a plain template, and turns {-y} into TMS rows and a subdomain into the first', () => {
    expect(xyzMapLibreTemplate('https://t/{z}/{x}/{y}.png')).toEqual({
      template: 'https://t/{z}/{x}/{y}.png',
      scheme: 'xyz',
    });
    expect(xyzMapLibreTemplate('https://{s}.t/{z}/{x}/{-y}.png')).toEqual({
      template: 'https://a.t/{z}/{x}/{y}.png',
      scheme: 'tms',
    });
    expect(xyzMapLibreTemplate('https://{a-c}.t/{z}/{x}/{y}.png').template).toBe('https://a.t/{z}/{x}/{y}.png');
  });
});

describe('absoluteTemplate', () => {
  const page = { protocol: 'https:', origin: 'https://pacha.example' };

  it('puts a path on the page’s origin and leaves the braces as they are', () => {
    expect(absoluteTemplate('/titiler/zarr/tiles/{z}/{x}/{y}.png?group={z}', page)).toBe(
      'https://pacha.example/titiler/zarr/tiles/{z}/{x}/{y}.png?group={z}'
    );
    expect(absoluteTemplate('//cdn.example/{z}/{x}/{y}.png', page)).toBe('https://cdn.example/{z}/{x}/{y}.png');
    expect(absoluteTemplate('http://t.example/{z}/{x}/{y}.png', page)).toBe('http://t.example/{z}/{x}/{y}.png');
  });
});

describe('nativeRasterOf', () => {
  it('reads the raster off a deck layer that offers one', () => {
    const layer = {
      props: {
        id: 'osm-layer-xyz-tiles',
        reliefTiles: 'https://t/{z}/{x}/{y}.png',
        reliefScheme: 'tms',
        tileSize: 256,
        minZoom: 0,
        maxZoom: null,
        opacity: 0.4,
        visible: false,
      },
    };
    expect(nativeRasterOf(layer)).toEqual({
      id: 'osm-layer-xyz-tiles',
      tiles: ['https://t/{z}/{x}/{y}.png'],
      scheme: 'tms',
      tileSize: 256,
      minzoom: 0,
      opacity: 0.4,
      visible: false,
    });
  });

  it('is null for any other layer', () => {
    expect(nativeRasterOf({ props: { id: 'points' } })).toBeNull();
    expect(nativeRasterOf('raster')).toBeNull();
    expect(nativeRasterOf(null)).toBeNull();
  });
});

describe('splitNativeRasters', () => {
  it('takes the rasters out in deck’s order and keeps the rest', () => {
    const a = { props: { id: 'a', reliefTiles: 'https://t/a/{z}/{x}/{y}' } };
    const b = { props: { id: 'b', reliefTiles: 'https://t/b/{z}/{x}/{y}' } };
    const points = { props: { id: 'points' } };
    const { kept, native } = splitNativeRasters([a, points, b]);
    expect(kept).toEqual([points]);
    expect(native.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('hands back the same array when there is no raster', () => {
    const layers = [{ props: { id: 'points' } }];
    expect(splitNativeRasters(layers).kept).toBe(layers);
  });
});

describe('syncNativeRasters', () => {
  it('adds a source and a raster layer each, on top of the base map, in order', () => {
    const map = new FakeRasterMap(['background', 'roads', 'labels']);
    expect(syncNativeRasters(map, [raster('a'), raster('b', { opacity: 0.5 })])).toBe(true);
    expect(map.getLayersOrder()).toEqual(['background', 'roads', 'labels', `${NATIVE_PREFIX}a`, `${NATIVE_PREFIX}b`]);
    expect(map.sources.get(`${NATIVE_PREFIX}a`)!.options).toEqual({
      type: 'raster',
      tiles: ['https://tiles.example/a/{z}/{x}/{y}.png'],
      scheme: 'xyz',
      tileSize: 256,
      minzoom: 0,
    });
    expect(map.getPaintProperty(`${NATIVE_PREFIX}b`, 'raster-opacity')).toBe(0.5);
  });

  it('does nothing the second time round', () => {
    const map = new FakeRasterMap(['background']);
    syncNativeRasters(map, [raster('a'), raster('b')]);
    map.moved = [];
    map.added = [];
    syncNativeRasters(map, [raster('a'), raster('b')]);
    expect(map.added).toEqual([]);
    expect(map.moved).toEqual([]);
  });

  it('swaps a new template into the same source, as a timeline steps', () => {
    const map = new FakeRasterMap();
    syncNativeRasters(map, [raster('z')]);
    const source = map.sources.get(`${NATIVE_PREFIX}z`)!;
    syncNativeRasters(map, [raster('z', { tiles: ['https://tiles.example/z/{z}/{x}/{y}.png?t=2'] })]);
    expect(map.sources.get(`${NATIVE_PREFIX}z`)).toBe(source);
    expect(source.setTiles).toHaveBeenCalledWith(['https://tiles.example/z/{z}/{x}/{y}.png?t=2']);
  });

  it('builds the source again when its zooms change', () => {
    const map = new FakeRasterMap();
    syncNativeRasters(map, [raster('z')]);
    const source = map.sources.get(`${NATIVE_PREFIX}z`);
    syncNativeRasters(map, [raster('z', { maxzoom: 3 })]);
    expect(map.sources.get(`${NATIVE_PREFIX}z`)).not.toBe(source);
    expect(map.getLayer(`${NATIVE_PREFIX}z`)).toBeTruthy();
  });

  it('follows opacity, visibility and order', () => {
    const map = new FakeRasterMap(['background']);
    syncNativeRasters(map, [raster('a'), raster('b')]);
    syncNativeRasters(map, [raster('b', { opacity: 0.2 }), raster('a', { visible: false })]);
    expect(map.getLayersOrder()).toEqual(['background', `${NATIVE_PREFIX}b`, `${NATIVE_PREFIX}a`]);
    expect(map.getPaintProperty(`${NATIVE_PREFIX}b`, 'raster-opacity')).toBe(0.2);
    expect(map.getLayoutProperty(`${NATIVE_PREFIX}a`, 'visibility')).toBe('none');
  });

  it('takes away what it added and nothing else', () => {
    const map = new FakeRasterMap(['background']);
    syncNativeRasters(map, [raster('a'), raster('b')]);
    syncNativeRasters(map, [raster('b')]);
    expect(map.getLayersOrder()).toEqual(['background', `${NATIVE_PREFIX}b`]);
    expect(map.sources.has(`${NATIVE_PREFIX}a`)).toBe(false);
    syncNativeRasters(map, []);
    expect(map.getLayersOrder()).toEqual(['background']);
    expect(map.sources.size).toBe(0);
  });

  it('says so while the style is loading, and adds them on the next try', () => {
    const map = new FakeRasterMap();
    map.loaded = false;
    expect(syncNativeRasters(map, [raster('a')])).toBe(false);
    map.loaded = true;
    expect(syncNativeRasters(map, [raster('a')])).toBe(true);
    expect(map.getLayer(`${NATIVE_PREFIX}a`)).toBeTruthy();
  });

  it('puts them back after a new style dropped them', () => {
    const map = new FakeRasterMap(['background']);
    syncNativeRasters(map, [raster('a')]);
    map.layers = [{ id: 'satellite', paint: {}, layout: {} }];
    map.sources.clear();
    syncNativeRasters(map, [raster('a')]);
    expect(map.getLayersOrder()).toEqual(['satellite', `${NATIVE_PREFIX}a`]);
  });
});
