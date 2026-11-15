import React from 'react';
import { act, render } from '@testing-library/react';
import { IconLayer } from '@deck.gl/layers';

import { terrainModelMatrix } from './terrainAnchor';
import { farZMultiplierFor, withTerrainAnchor } from './terrainMapContainer';

/**
 * The wrapper around kepler's `MapContainer` that stands the markers and the
 * symbols on the relief, against a stand-in doing what kepler does: hand its
 * deck props to `onDeckRender`, and render `bottomMapContainerProps.children`
 * inside the bottom map — where `useMap` finds a MapLibre map faked here.
 */

type Listener = (event: { type: string; sourceId?: string }) => void;

const listeners = new Map<string, Set<Listener>>();
let terrain: { source: string } | null = { source: 'terrain-dem' };
let ground = 3000;

/** The raster layers the panel hands to MapLibre, by id, in order. */
let styleLayers: string[] = [];
const styleSources = new Map<string, { serialize(): Record<string, unknown> }>();

const reliefMap = {
  getSource: (id: string) => styleSources.get(id),
  addSource: (id: string, spec: Record<string, unknown>) => styleSources.set(id, { serialize: () => spec }),
  removeSource: (id: string) => styleSources.delete(id),
  getLayer: (id: string) => (styleLayers.includes(id) ? { id } : undefined),
  addLayer: (layer: { id: string }) => styleLayers.push(layer.id),
  removeLayer: (id: string) => (styleLayers = styleLayers.filter((other) => other !== id)),
  moveLayer: (id: string) => (styleLayers = [...styleLayers.filter((other) => other !== id), id]),
  getLayersOrder: () => styleLayers,
  getPaintProperty: () => undefined,
  setPaintProperty: () => undefined,
  getLayoutProperty: () => undefined,
  setLayoutProperty: () => undefined,
  getTerrain: () => terrain,
  queryTerrainElevation: ([lng]: [number, number]) => (terrain ? (lng === -79 ? 2500 : ground) : null),
  on: (type: string, listener: Listener) => {
    listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
  },
  off: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
};

function fire(type: string, sourceId?: string) {
  listeners.get(type)?.forEach((listener) => listener({ type, sourceId }));
}

jest.mock('@vis.gl/react-maplibre', () => ({
  useMap: () => ({ current: { getMap: () => reliefMap } }),
}));

let decks: Array<{ layers: unknown[] } | null> = [];
/** More deck layers kepler hands over, after the symbols and the raster. */
let extraLayers: unknown[] = [];

const symbols = () =>
  new IconLayer({
    id: 'sym-symbol',
    data: [{ position: [-78.9, -2.9, 0] }],
    getPosition: (row: { position: number[] }) => row.position as [number, number, number],
  });

const StandIn = (props: {
  deckRenderCallbacks?: { onDeckRender?: (p: Record<string, unknown>) => Record<string, unknown> | null };
  bottomMapContainerProps?: { children?: React.ReactNode };
}) => {
  const deckProps = { layers: [symbols(), 'raster', ...extraLayers] };
  const onDeckRender = props.deckRenderCallbacks?.onDeckRender;
  decks.push(onDeckRender ? (onDeckRender(deckProps) as never) : deckProps);
  return <>{props.bottomMapContainerProps?.children}</>;
};

const visState = {
  layers: [
    { id: 'sym', type: 'symbol' },
    { id: 'raster', type: 'rasterTile' },
  ],
};

function mount(layers = visState.layers) {
  const Container = withTerrainAnchor(StandIn as React.ComponentType<any>);
  render(<Container visState={{ layers }} mapState={{ longitude: -79, latitude: -2.9 }} />);
}

const lastSymbols = () => decks[decks.length - 1]!.layers[0] as IconLayer;
const zOf = (layer: IconLayer) =>
  (layer.props.getPosition as unknown as (row: unknown, info: unknown) => number[])(
    { position: [-78.9, -2.9, 0] },
    {}
  )[2];

beforeEach(() => {
  jest.useFakeTimers();
  decks = [];
  listeners.clear();
  terrain = { source: 'terrain-dem' };
  ground = 3000;
  extraLayers = [];
  styleLayers = [];
  styleSources.clear();
});

afterEach(() => jest.useRealTimers());

describe('withTerrainAnchor', () => {
  it('stands the symbols on the relief once the bottom map has reported it', () => {
    mount();
    const lifted = lastSymbols();
    expect(lifted.props.modelMatrix).toEqual(terrainModelMatrix(2500));
    expect(zOf(lifted)).toBe(3000);
  });

  it('lifts them again when more relief arrives', () => {
    mount();
    expect(zOf(lastSymbols())).toBe(3000);
    ground = 3100;
    act(() => {
      fire('sourcedata', 'some-other-source');
      jest.runAllTimers();
    });
    expect(zOf(lastSymbols())).toBe(3000);

    act(() => {
      fire('sourcedata', 'terrain-dem');
      fire('sourcedata', 'terrain-dem');
      jest.runAllTimers();
    });
    expect(zOf(lastSymbols())).toBe(3100);
  });

  it('draws kepler’s layers untouched on a flat basemap', () => {
    terrain = null;
    mount();
    expect(lastSymbols().props.modelMatrix).toBeFalsy();
  });

  it('stays out of the way of a map with no markers, symbols or rasters', () => {
    mount([{ id: 'raster', type: 'geojson' }]);
    expect(listeners.size).toBe(0);
    expect(lastSymbols().props.modelMatrix).toBeFalsy();
  });

  it('hands a tile template to MapLibre on the relief, and leaves it to deck off it', () => {
    const tiles = {
      id: 'osm-layer-xyz-tiles',
      props: { id: 'osm-layer-xyz-tiles', reliefTiles: 'https://t/{z}/{x}/{y}.png' },
    };
    extraLayers = [tiles];
    mount([...visState.layers, { id: 'osm-layer', type: 'xyz-tiles' }]);
    act(() => {
      // Jest's fake timers hold queueMicrotask too.
      jest.runAllTicks();
    });
    expect(decks[decks.length - 1]!.layers).not.toContain(tiles);
    expect(styleLayers).toEqual(['kepler-relief-raster-osm-layer-xyz-tiles']);

    terrain = null;
    act(() => {
      fire('terrain');
      jest.runAllTimers();
    });
    act(() => {
      // Jest's fake timers hold queueMicrotask too.
      jest.runAllTicks();
    });
    expect(decks[decks.length - 1]!.layers).toContain(tiles);
    expect(styleLayers).toEqual([]);
  });

  it('watches the relief for a map with only a raster', () => {
    mount([{ id: 'raster', type: 'rasterTile' }]);
    expect(listeners.get('sourcedata')?.size).toBe(1);
  });
});

describe('farZMultiplierFor', () => {
  const view = { zoom: 12.6, latitude: -1.47, pitch: 0, height: 765 };

  it('keeps kepler’s 1.2 when nothing lies below the centre', () => {
    expect(farZMultiplierFor(0, view)).toBeNull();
  });

  it('pushes the far plane back by the drop under the centre, in camera distances', () => {
    // 12.6: about 12.7 m a pixel at the equator, the camera 1.5 × 765 px ≈ 14.6 km from the centre.
    const m = farZMultiplierFor(3750, view)!;
    expect(m).toBeGreaterThan(1.4);
    expect(m).toBeLessThanOrEqual(1.75);
    expect(farZMultiplierFor(3750, { ...view, pitch: 60 })!).toBeGreaterThan(m);
  });

  it('never asks past deck’s cap', () => {
    expect(farZMultiplierFor(9000, { ...view, zoom: 17 })).toBe(10);
  });
});
