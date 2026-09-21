import React from 'react';
import { render } from '@testing-library/react';

import { HaloContext, withHaloLayers, withSelectionHalo } from './haloMapContainer';
import type { Selection } from './selectionHalo';

/**
 * The wrapper around kepler's `MapContainer`, against a stand-in that does what
 * kepler does with `deckRenderCallbacks`: call `onDeckRender` with the props it
 * is about to hand deck. `keplerRecipes.test.ts` proves the real container is
 * the one wrapped.
 */

const rows = [
  [-2.9, -79.02, 'site-01'],
  [-2.895, -79.02, 'site-02'],
];

const visState = {
  layers: [
    {
      id: 'points',
      type: 'point',
      config: {
        dataId: 'A',
        isVisible: true,
        columns: { lat: { fieldIdx: 0 }, lng: { fieldIdx: 1 } },
        visConfig: { radius: 10 },
      },
    },
  ],
  datasets: {
    A: {
      fields: [{ name: 'latitude' }, { name: 'longitude' }, { name: 'site' }],
      dataContainer: { numRows: () => rows.length, valueAt: (row: number, column: number) => rows[row][column] },
    },
  },
  filters: [],
  splitMaps: [],
};

/** What the stand-in container saw deck being handed, per render. */
let handed: Array<Record<string, unknown> | null | 'no callback'> = [];

const StandIn = (props: { deckRenderCallbacks?: { onDeckRender?: (p: Record<string, unknown>) => unknown } }) => {
  const onDeckRender = props.deckRenderCallbacks?.onDeckRender;
  handed.push(
    onDeckRender ? (onDeckRender({ layers: ['kepler-layer'] }) as Record<string, unknown> | null) : 'no callback'
  );
  return null;
};

function mount(selection: Selection | null, props: Record<string, unknown> = {}) {
  const Container = withSelectionHalo(StandIn as React.ComponentType<any>);
  render(
    <HaloContext.Provider value={selection}>
      <Container visState={visState} mapState={{ zoom: 13 }} index={0} {...props} />
    </HaloContext.Provider>
  );
  return handed[handed.length - 1];
}

beforeEach(() => {
  handed = [];
});

describe('withSelectionHalo', () => {
  it('hands kepler’s layers through untouched and draws the halo after them', () => {
    const deck = mount({ site: ['site-02'] }) as { layers: Array<string | { id: string; props: any }> };

    expect(deck.layers[0]).toBe('kepler-layer');
    expect(deck.layers).toHaveLength(2);
    const halo = deck.layers[1] as { id: string; props: any };
    expect(halo.id).toBe('panel-selection-halo-points-0');
    expect(halo.props.pickable).toBe(false);
    expect(halo.props.data).toEqual([{ position: [-79.02, -2.895], radiusPx: 10 }]);
  });

  it('leaves kepler alone when nothing is selected', () => {
    expect(mount({})).toBe('no callback');
    expect(mount(null)).toBe('no callback');
  });

  it('gives each side of a split map a halo of its own', () => {
    const deck = mount({ site: ['site-02'] }, { index: 1 }) as { layers: Array<string | { id: string }> };
    expect((deck.layers[1] as { id: string }).id).toBe('panel-selection-halo-points-1');
  });

  it('still runs a render callback kepler was already given', () => {
    const chained = (props: Record<string, unknown>) => ({
      ...props,
      layers: [...(props.layers as unknown[]), 'other-layer'],
    });
    const deck = mount({ site: ['site-02'] }, { deckRenderCallbacks: { onDeckRender: chained } }) as {
      layers: Array<string | { id: string }>;
    };

    expect(deck.layers.slice(0, 2)).toEqual(['kepler-layer', 'other-layer']);
    expect((deck.layers[2] as { id: string }).id).toBe('panel-selection-halo-points-0');
  });
});

describe('withSelectionHalo, repainting', () => {
  // kepler re-renders MapContainer on every hover, pan frame and animation
  // tick. New `data` would have deck re-read every ring and re-tessellate every
  // outline each time; the same arrays let it skip that.
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-79.03, -2.91],
        [-79.01, -2.91],
        [-79.01, -2.89],
        [-79.03, -2.91],
      ],
    ],
  };
  const zones = [[polygon, 'north']];
  const withZones = {
    ...visState,
    layers: [
      ...visState.layers,
      { id: 'zones', type: 'geojson', config: { dataId: 'Z', isVisible: true, columns: { geojson: { fieldIdx: 0 } } } },
    ],
    datasets: {
      ...visState.datasets,
      Z: {
        fields: [{ name: '_geojson' }, { name: 'name' }],
        dataContainer: { numRows: () => zones.length, valueAt: (row: number, column: number) => zones[row][column] },
      },
    },
  };
  const selection: Selection = { site: ['site-02'], name: ['north'] };

  type HaloLayerSeen = { id: string; props: { data: unknown[] } };

  /** The halo layers deck was handed on the last render, by kind. */
  function lastHalo() {
    const layers = (handed[handed.length - 1] as { layers: Array<string | HaloLayerSeen> }).layers.filter(
      (layer): layer is HaloLayerSeen => typeof layer !== 'string'
    );
    return {
      rings: layers.find((layer) => layer.id.startsWith('panel-selection-halo-points'))!.props.data,
      outlines: layers.find((layer) => layer.id.startsWith('panel-selection-halo-outlines'))!.props.data,
    };
  }

  function mountRepainting(initial: Selection) {
    const Container = withSelectionHalo(StandIn as React.ComponentType<any>);
    const tree = (current: Selection, props: Record<string, unknown>) => (
      <HaloContext.Provider value={current}>
        <Container visState={withZones} mapState={{ zoom: 13 }} index={0} {...props} />
      </HaloContext.Provider>
    );
    const { rerender } = render(tree(initial, {}));
    return (current: Selection, props: Record<string, unknown>) => rerender(tree(current, props));
  }

  it('hands deck a selected polygon as outline lines, nothing to tessellate', () => {
    mountRepainting(selection);
    expect(lastHalo().outlines).toEqual([
      expect.objectContaining({ geometry: { type: 'MultiLineString', coordinates: polygon.coordinates } }),
    ]);
  });

  it('hands deck the same data while the pointer or the view moves', () => {
    const repaint = mountRepainting(selection);
    const before = lastHalo();

    // A hover and a pan: kepler hands a new vis state object and a new map
    // state, but the layers, datasets, filters and split are the same.
    repaint(selection, {
      visState: { ...withZones, hoverInfo: { index: 0 } },
      mapState: { zoom: 13, latitude: -2.9, longitude: -79.02 },
    });
    const after = lastHalo();

    expect(handed.length).toBeGreaterThan(1);
    expect(after.rings).toBe(before.rings);
    expect(after.outlines).toBe(before.outlines);
  });

  it('draws new rings when the zoom changes, keeping the outlines', () => {
    const repaint = mountRepainting(selection);
    const before = lastHalo();

    repaint(selection, { mapState: { zoom: 17 } });
    const after = lastHalo();

    expect(after.rings).not.toBe(before.rings);
    expect(after.outlines).toBe(before.outlines);
  });

  it('hands deck new data when the selection changes', () => {
    const repaint = mountRepainting(selection);
    const before = lastHalo();

    repaint({ site: ['site-01'], name: ['north'] }, {});
    const after = lastHalo();

    expect(after.rings).not.toBe(before.rings);
    expect(after.rings).toEqual([{ position: [-79.02, -2.9], radiusPx: 10 }]);
    expect(after.outlines).not.toBe(before.outlines);
  });
});

describe('withHaloLayers', () => {
  it('lets a callback that cancels the render cancel it', () => {
    expect(withHaloLayers({ layers: [] }, ['halo'], () => null)).toBeNull();
  });

  it('returns kepler’s props as they were when there is no halo', () => {
    const props = { layers: ['kepler-layer'] };
    expect(withHaloLayers(props, [])).toBe(props);
  });
});
