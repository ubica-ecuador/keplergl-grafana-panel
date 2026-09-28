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

function mounted(props: Record<string, unknown>, picked: MarkerSpec | null = markers[0]) {
  const layer = new DraggableMarkersLayer({ ...baseProps, ...props } as never) as any;
  const { context, handlers } = deckContext(picked);
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
});
