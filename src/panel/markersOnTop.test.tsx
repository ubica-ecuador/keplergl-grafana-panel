import React from 'react';
import { render } from '@testing-library/react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { useControl } from '@vis.gl/react-maplibre';

import { HaloContext, withPanelLayers } from './haloMapContainer';
import { MarkerDrag } from './markerDrag';
import { DraggableMarkersLayer } from './markersDeckLayer';
import { liftMarkers, withMarkersOnTop } from './markersOnTop';

/**
 * The wrapper around kepler's `MapContainer` that keeps markers on top, against
 * a stand-in doing what kepler does in the same order: hand the main deck's
 * props to `onDeckRender`, hand the geocoder's overlay to it again when there
 * is one, and render `topMapContainerProps.children` inside the top map.
 *
 * `useControl` and `useMap` need a live MapLibre map, which jsdom cannot give;
 * `useControl` stands in here by creating the control once and handing it back,
 * as it does in a map.
 */
jest.mock('@vis.gl/react-maplibre', () => ({
  useControl: jest.fn(),
  // A MapLibre 6 map, as far as deck's drawing needs: its transform lives on the camera.
  useMap: () => ({ current: { getMap: () => topMap } }),
}));

const topMap = { _camera: { transform: { height: 512 } } };

let overlay: MapboxOverlay | null = null;
let overlayLayers: unknown[][] = [];

beforeEach(() => {
  overlay = null;
  overlayLayers = [];
  (useControl as jest.Mock).mockImplementation((create: () => MapboxOverlay) => {
    if (!overlay) {
      overlay = create();
      const setProps = overlay.setProps.bind(overlay);
      overlay.setProps = (props) => {
        overlayLayers.push((props.layers ?? []) as unknown[]);
        setProps(props);
      };
    }
    return overlay;
  });
});

const markersDeckLayer = (visible = true) =>
  new DraggableMarkersLayer({
    id: 'punto-markers',
    keplerLayerId: 'punto',
    markers: [],
    radiusPx: 10,
    symbol: 'circle',
    angleDegrees: 0,
    visible,
    drag: new MarkerDrag(),
    interactive: true,
  } as never);

const cartoDarkMatter = {
  styleType: 'dark-matter',
  mapStyles: { 'dark-matter': { url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' } },
};

const visState = {
  layers: [
    { id: 'punto', type: 'markers', config: { isVisible: true, visConfig: {} } },
    { id: 'accesibilidad', type: 'rasterTile', config: { isVisible: true } },
  ],
  datasets: {},
  filters: [],
  splitMaps: [],
};

interface Seen {
  deck: Record<string, unknown> | null | 'no callback';
  topMapContainerProps?: Record<string, unknown>;
}

let seen: Seen[] = [];

/** What kepler hands deck this render, and whether it also draws the geocoder's overlay. */
let keplerDeck: { layers: unknown[]; geocoder?: boolean } = { layers: [] };

const StandIn = (props: {
  deckRenderCallbacks?: { onDeckRender?: (p: Record<string, unknown>) => Record<string, unknown> | null };
  topMapContainerProps?: Record<string, unknown> & { children?: React.ReactNode };
}) => {
  const onDeckRender = props.deckRenderCallbacks?.onDeckRender;
  const deck = onDeckRender ? onDeckRender({ layers: keplerDeck.layers }) : 'no callback';
  if (onDeckRender && keplerDeck.geocoder) {
    // kepler's second overlay, drawn above the top map, holds only the geocoder's pin.
    onDeckRender({ layers: ['geocoder-layer'] });
  }
  seen.push({ deck, topMapContainerProps: props.topMapContainerProps });
  return <>{props.topMapContainerProps?.children}</>;
};

function mount(props: Record<string, unknown> = {}) {
  const Container = withMarkersOnTop(StandIn as React.ComponentType<any>);
  render(<Container visState={visState} mapStyle={cartoDarkMatter} mapState={{ zoom: 13 }} index={0} {...props} />);
  return seen[seen.length - 1];
}

beforeEach(() => {
  seen = [];
  keplerDeck = { layers: [] };
});

describe('liftMarkers', () => {
  it('moves the markers after every other layer, keeping each group in its order', () => {
    const markers = markersDeckLayer();
    expect(liftMarkers([markers, 'raster', 'halo'])).toEqual(['raster', 'halo', markers]);
  });

  it('returns the same list when there are no markers to move', () => {
    const layers = ['raster', 'halo'];
    expect(liftMarkers(layers)).toBe(layers);
  });
});

describe('withMarkersOnTop', () => {
  it('draws the markers after every other layer of kepler’s deck, whatever their order in the panel', () => {
    const markers = markersDeckLayer();
    keplerDeck = { layers: [markers, 'accesibilidad-raster'] };

    const { deck } = mount();
    expect((deck as { layers: unknown[] }).layers).toEqual(['accesibilidad-raster', markers]);
  });

  it('draws a copy of the markers above the top map’s roads and labels, one that cannot be grabbed', () => {
    const markers = markersDeckLayer();
    keplerDeck = { layers: [markers, 'accesibilidad-raster'] };
    mount();

    const above = overlayLayers[overlayLayers.length - 1] as DraggableMarkersLayer[];
    expect(above).toHaveLength(1);
    expect(above[0]).toBeInstanceOf(DraggableMarkersLayer);
    expect(above[0]).not.toBe(markers);
    expect(above[0].id).toBe('punto-markers');
    expect(above[0].props.interactive).toBe(false);
    // The same drag, so the copy above follows the one grabbed below.
    expect(above[0].props.drag).toBe(markers.props.drag);
  });

  it('keeps the copy above when kepler also draws the geocoder’s overlay', () => {
    keplerDeck = { layers: [markersDeckLayer()], geocoder: true };
    mount();
    expect(overlayLayers[overlayLayers.length - 1]).toHaveLength(1);
  });

  it('shows the copy above only while kepler draws the markers', () => {
    // Switched off with the eye, the layer is not in kepler's deck at all.
    keplerDeck = { layers: ['accesibilidad-raster'] };
    mount();
    expect(overlayLayers[overlayLayers.length - 1]).toEqual([]);
  });

  it('keeps the props kepler gives the top map, and any render callback it was given', () => {
    const markers = markersDeckLayer();
    keplerDeck = { layers: [markers] };
    const chained = (props: Record<string, unknown>) => ({
      ...props,
      layers: [...(props.layers as unknown[]), 'other-layer'],
    });

    const { deck, topMapContainerProps } = mount({
      deckRenderCallbacks: { onDeckRender: chained },
      topMapContainerProps: { mapLib: 'kepler-top' },
    });
    expect((deck as { layers: unknown[] }).layers).toEqual(['other-layer', markers]);
    expect(topMapContainerProps?.mapLib).toBe('kepler-top');
  });

  it('lets a callback that cancels the render cancel it', () => {
    keplerDeck = { layers: [markersDeckLayer()] };
    const { deck } = mount({ deckRenderCallbacks: { onDeckRender: () => null } });
    expect(deck).toBeNull();
  });

  it('leaves kepler alone on a map without markers', () => {
    const { deck, topMapContainerProps } = mount({
      visState: { ...visState, layers: [visState.layers[1]] },
    });
    expect(deck).toBe('no callback');
    expect(topMapContainerProps).toBeUndefined();
  });

  it('adds nothing to the top map of a Mapbox basemap, where it is not a MapLibre map', () => {
    const markers = markersDeckLayer();
    keplerDeck = { layers: [markers, 'accesibilidad-raster'] };

    const { deck, topMapContainerProps } = mount({
      mapStyle: { styleType: 'streets', mapStyles: { streets: { url: 'mapbox://styles/mapbox/streets-v12' } } },
    });
    expect(topMapContainerProps).toBeUndefined();
    expect((deck as { layers: unknown[] }).layers).toEqual(['accesibilidad-raster', markers]);
  });
});

describe('withPanelLayers', () => {
  it('draws the markers above the selection halo too', () => {
    const markers = markersDeckLayer();
    keplerDeck = { layers: [markers] };
    const rows = [[-2.9, -79.02, 'site-01']];
    const withPoints = {
      ...visState,
      layers: [
        ...visState.layers,
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
    };

    const Container = withPanelLayers(StandIn as React.ComponentType<any>) as React.ComponentType<any>;
    render(
      <HaloContext.Provider value={{ site: ['site-01'] }}>
        <Container visState={withPoints} mapStyle={cartoDarkMatter} mapState={{ zoom: 13 }} index={0} />
      </HaloContext.Provider>
    );

    const layers = (seen[seen.length - 1].deck as { layers: Array<{ id?: string }> }).layers;
    expect(layers[0].id).toBe('panel-selection-halo-points-0');
    expect(layers[layers.length - 1]).toBe(markers);
  });
});
