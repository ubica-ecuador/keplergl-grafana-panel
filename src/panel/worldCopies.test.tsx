import React from 'react';
import { render } from '@testing-library/react';
import { MapView, WebMercatorViewport, _GlobeView as GlobeView } from '@deck.gl/core';

import { onNearestWorldCopy, repeatWorldCopies } from './worldCopies';
import { withWorldCopies } from './worldCopiesMapContainer';

describe('repeatWorldCopies', () => {
  it("draws kepler's flat map view on every world copy, its other props kept", () => {
    const out = repeatWorldCopies({ layers: ['a'], views: new MapView({ farZMultiplier: 1.2 }) });
    const view = out?.views as MapView;
    expect(view).toBeInstanceOf(MapView);
    expect(view.props).toMatchObject({ repeat: true, farZMultiplier: 1.2 });
    expect(out?.layers).toEqual(['a']);
  });

  it('leaves a globe, a view that already repeats, no view and no deck alone', () => {
    const globe = { views: new GlobeView({ resolution: 5 }) };
    expect(repeatWorldCopies(globe)).toBe(globe);
    const repeating = { views: new MapView({ repeat: true }) };
    expect(repeatWorldCopies(repeating)).toBe(repeating);
    const none = { layers: [] };
    expect(repeatWorldCopies(none)).toBe(none);
    expect(repeatWorldCopies(null)).toBeNull();
  });

  it('gives deck a view with one sub-viewport per copy in view', () => {
    const view = repeatWorldCopies({ views: new MapView({}) })?.views as MapView;
    const size = { width: 1550, height: 810 };
    const across = view.makeViewport({ ...size, viewState: { longitude: 178, latitude: -18, zoom: 3 } });
    expect(across?.subViewports).toHaveLength(2);
    const zoomedOut = view.makeViewport({ ...size, viewState: { longitude: 0, latitude: 0, zoom: 0.3 } });
    expect(zoomedOut?.subViewports?.length).toBeGreaterThanOrEqual(3);
    const inside = view.makeViewport({ ...size, viewState: { longitude: -78.5, latitude: -0.2, zoom: 5 } });
    expect(inside?.subViewports).toHaveLength(1);
  });
});

describe('onNearestWorldCopy', () => {
  const viewport = (longitude: number) =>
    new WebMercatorViewport({ width: 1000, height: 800, longitude, latitude: -18, zoom: 3 });

  it("projects a callout across the antimeridian on the copy in view, as kepler's own overlay does not", () => {
    const vp = viewport(-176);
    const suva = [178.44, -18.14];
    expect(vp.project(suva)[0]).toBeGreaterThan(1000); // off screen, 354° east
    const [x, y] = onNearestWorldCopy(vp).project(suva);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(500); // 5.56° west of the centre
    expect(y).toBeCloseTo(vp.project([-181.56, -18.14])[1]);
  });

  it('projects a place on the view side as kepler does, altitude kept', () => {
    const vp = viewport(178);
    const quito = [178.5, -18, 100];
    expect(onNearestWorldCopy(vp).project(quito)).toEqual(vp.project(quito));
  });

  it('keeps unproject and the rest of the viewport', () => {
    const vp = viewport(178);
    const wrapped = onNearestWorldCopy(vp);
    expect(wrapped.unproject).toBe(vp.unproject);
    expect(wrapped.longitude).toBe(178);
  });
});

describe('withWorldCopies', () => {
  it('repeats the view after the callbacks already in place, and leaves their layers', () => {
    let handed: Record<string, unknown> | null = null;
    const StandIn = (props: {
      deckRenderCallbacks?: { onDeckRender?: (p: Record<string, unknown>) => Record<string, unknown> | null };
    }) => {
      handed = props.deckRenderCallbacks!.onDeckRender!({ layers: ['kepler'], views: new MapView({}) });
      return null;
    };
    const Wrapped = withWorldCopies(StandIn);
    const outer = (p: Record<string, unknown>) => ({ ...p, layers: [...(p.layers as string[]), 'halo'] });
    render(<Wrapped deckRenderCallbacks={{ onDeckRender: outer }} />);
    expect(handed!.layers).toEqual(['kepler', 'halo']);
    expect((handed!.views as MapView).props.repeat).toBe(true);
  });

  it('draws no deck when a callback before it says so', () => {
    let handed: unknown = 'unset';
    const StandIn = (props: { deckRenderCallbacks?: { onDeckRender?: (p: Record<string, unknown>) => unknown } }) => {
      handed = props.deckRenderCallbacks!.onDeckRender!({ views: new MapView({}) });
      return null;
    };
    const Wrapped = withWorldCopies(StandIn);
    render(<Wrapped deckRenderCallbacks={{ onDeckRender: () => null }} />);
    expect(handed).toBeNull();
  });
});
