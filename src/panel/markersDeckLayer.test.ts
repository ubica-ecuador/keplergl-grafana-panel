import { MarkerDrag } from './markerDrag';
import type { MarkerSpec } from './markers';
import { DraggableMarkersLayer, MARKER_DROP_EVENT, MarkerDropDetail } from './markersDeckLayer';

/**
 * The deck layer's glue, without WebGL: what it reads from the shared drag when
 * it draws, and what it writes there when the pointer carries a marker. The
 * rules of the drag itself are `markerDrag.test.ts`'s.
 */

const markers: MarkerSpec[] = [
  { id: 'a', label: 'Punto', color: [230, 57, 70], latVariable: 'lat', lngVariable: 'lng', position: [-79, -2.9] },
];

const baseProps = {
  id: 'punto-markers',
  keplerLayerId: 'punto',
  markers,
  radiusPx: 10,
  symbol: 'circle',
  angleDegrees: 0,
  visible: true,
};

type Handler = (event: Record<string, unknown>) => void;

/** A deck context whose screen is the map: one pixel per degree, no projection to speak of. */
function deckContext(picked: MarkerSpec | null) {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    context: {
      deck: {
        eventManager: {
          on: (type: string, handler: Handler) => handlers.set(type, handler),
          off: (type: string) => handlers.delete(type),
        },
        pickObject: () => (picked ? { object: picked } : null),
      },
      viewport: {
        project: ([x, y]: number[]) => [x, y],
        unproject: ([x, y]: number[]) => [x, y],
      },
    },
  };
}

function mounted(props: Record<string, unknown>, picked: MarkerSpec | null = markers[0], viewport?: object) {
  const layer = new DraggableMarkersLayer({ ...baseProps, ...props } as never) as any;
  const { context, handlers } = deckContext(picked);
  if (viewport) {
    context.viewport = viewport as typeof context.viewport;
  }
  layer.context = context;
  layer.state = {};
  layer.initializeState();
  return { layer, handlers };
}

function gesture(type: string, x: number, y: number, target?: EventTarget) {
  return {
    type,
    offsetCenter: { x, y },
    deltaX: 0,
    deltaY: 0,
    srcEvent: { target },
    stopImmediatePropagation: jest.fn(),
  };
}

/** Where the drawn handles are, as deck is handed them. */
function drawnPositions(layer: any): unknown[] {
  return layer.renderLayers()[0].props.data.map((marker: MarkerSpec) => marker.position);
}

describe('DraggableMarkersLayer', () => {
  it('draws a marker where a drag handled by another copy carries it', () => {
    const drag = new MarkerDrag();
    const above = new DraggableMarkersLayer({ ...baseProps, drag, interactive: false } as never);

    expect(drawnPositions(above)).toEqual([[-79, -2.9]]);

    const owner = {};
    drag.start(owner, 'a', [-79, -2.9]);
    drag.move(owner, [-78.5, -3.1]);
    expect(drawnPositions(above)).toEqual([[-78.5, -3.1]]);
  });

  it('listens to the pointer only in the copy that can be grabbed', () => {
    expect(mounted({ drag: new MarkerDrag() }).handlers.size).toBe(3);
    expect(mounted({ drag: new MarkerDrag(), interactive: false }).handlers.size).toBe(0);
  });

  it('makes nothing pickable in the copy that cannot be grabbed', () => {
    const above = new DraggableMarkersLayer({ ...baseProps, drag: new MarkerDrag(), interactive: false } as never);
    expect((above as any).renderLayers()[0].props.pickable).toBe(false);
  });

  it('carries a grabbed marker in the shared drag and announces where it was dropped', () => {
    const drag = new MarkerDrag();
    const { layer } = mounted({ drag });
    const target = new EventTarget();
    const drops: MarkerDropDetail[] = [];
    target.addEventListener(MARKER_DROP_EVENT, (event) => drops.push((event as CustomEvent).detail));

    const start = gesture('panstart', -79, -2.9);
    layer.onGesture(start);
    layer.onGesture(gesture('panmove', -78.6, -3));
    expect(start.stopImmediatePropagation).toHaveBeenCalled();
    expect(drag.moved()).toEqual({ id: 'a', position: [-78.6, -3] });

    layer.onGesture(gesture('panend', -78.5, -3.1, target));
    expect(drops).toEqual([{ layerId: 'punto', markerId: 'a', position: [-78.5, -3.1] }]);
    expect(drag.moved()).toEqual({ id: 'a', position: [-78.5, -3.1] });
  });

  it('lets a pan that starts off every marker move the map', () => {
    const drag = new MarkerDrag();
    const { layer } = mounted({ drag }, null);

    const start = gesture('panstart', 0, 0);
    const move = gesture('panmove', 1, 1);
    layer.onGesture(start);
    layer.onGesture(move);

    expect(start.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(move.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(drag.moved()).toBeNull();
  });

  it('drops a held position once the layer carries new markers', () => {
    const drag = new MarkerDrag();
    const { layer } = mounted({ drag });
    layer.onGesture(gesture('panstart', -79, -2.9));
    layer.onGesture(gesture('panend', -78.5, -3.1, new EventTarget()));

    layer.updateState({ props: { ...layer.props, markers: [...markers] }, oldProps: layer.props });
    expect(drag.moved()).toBeNull();
  });

  describe('on relief', () => {
    // The ground 1000 m above the centre everywhere; the model matrix the layer
    // is cloned with takes the centre's 2000 m off.
    const terrain = { centre: 2000, version: 3, elevationAt: () => 3000 };
    // A camera on which a point 1000 m up shows one degree east of its foot.
    const viewport = {
      project: ([x, y, z = 0]: number[]) => [x + z / 1000, y],
      unproject: ([x, y]: number[], opts?: { targetZ?: number }) => [x - (opts?.targetZ ?? 0) / 1000, y],
    };

    it('draws the markers at the elevation of the ground under them', () => {
      const layer = new DraggableMarkersLayer({ ...baseProps, drag: new MarkerDrag(), terrain } as never) as any;
      const handles = layer.renderLayers()[0];
      expect(handles.props.getPosition(markers[0])).toEqual([-79, -2.9, 3000]);
      expect(handles.props.updateTriggers.getPosition).toContain(3);
    });

    it('drops a marker on the ground under the pointer, not on the plane below it', () => {
      const drag = new MarkerDrag();
      const { layer } = mounted({ drag, terrain }, markers[0], viewport);
      const target = new EventTarget();
      const drops: MarkerDropDetail[] = [];
      target.addEventListener(MARKER_DROP_EVENT, (event) => drops.push((event as CustomEvent).detail));

      // Grabbed where it shows, a degree east of its foot.
      layer.onGesture(gesture('panstart', -78, -2.9));
      layer.onGesture(gesture('panend', -77.5, -3.1, target));

      // Drawn back 1000 m up, it shows where the pointer let go of it.
      expect(drops).toEqual([{ layerId: 'punto', markerId: 'a', position: [-78.5, -3.1] }]);
    });

    it('settles on a steep slope facing the camera, where the ground height swings the ray back and forth', () => {
      // 600 m higher per degree east: taken straight, each pass undoes six
      // tenths of the last one's step and the answer is circled, not reached.
      const slope = { centre: 2000, version: 1, elevationAt: (lng: number) => 2000 + 600 * (lng + 77.5) };
      const drag = new MarkerDrag();
      const { layer } = mounted({ drag, terrain: slope }, markers[0], viewport);
      const target = new EventTarget();
      const drops: MarkerDropDetail[] = [];
      target.addEventListener(MARKER_DROP_EVENT, (event) => drops.push((event as CustomEvent).detail));

      // The marker's foot, at -79, is 900 m below the centre: it shows at -79.9.
      layer.onGesture(gesture('panstart', -79.9, -2.9));
      layer.onGesture(gesture('panend', -77, -2.9, target));

      // The one point whose ground shows at -77: lng = -77 - 0.6 (lng + 77.5).
      expect(drops[0].position[0]).toBeCloseTo(-77.1875, 2);
    });
  });
});
