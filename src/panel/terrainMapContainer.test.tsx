import React from 'react';
import { act, render } from '@testing-library/react';
import { IconLayer } from '@deck.gl/layers';

import { terrainModelMatrix } from './terrainAnchor';
import { withTerrainAnchor } from './terrainMapContainer';

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

const reliefMap = {
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
  const deckProps = { layers: [symbols(), 'raster'] };
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

  it('stays out of the way of a map with neither markers nor symbols', () => {
    mount([{ id: 'raster', type: 'rasterTile' }]);
    expect(listeners.size).toBe(0);
    expect(lastSymbols().props.modelMatrix).toBeFalsy();
  });
});
