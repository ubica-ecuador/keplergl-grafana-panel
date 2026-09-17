import { CompositeLayer, Layer } from '@deck.gl/core';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import type { LngLat, MarkerSpec } from './markers';
import { buildSymbolDeckLayer } from './symbolDeckLayer';
import { deckAngle } from './symbolLayer';

/**
 * The deck.gl layer that draws the markers and lets the user drag them.
 *
 * **Why the pan has to be stolen.** A deck layer's own `onDrag*` props fire, but
 * the map controller receives the same pointer events and pans underneath the
 * marker. kepler's drawing editor (`@deck.gl-community/editable-layers`) meets
 * the same problem and solves it this way: listen on deck's event manager at a
 * higher priority than the controller and call `stopImmediatePropagation` when
 * the gesture starts on something of ours. The controller then never sees the
 * pan. A gesture that starts off a marker is left alone and pans the map.
 *
 * **Why the drop leaves as a DOM event.** A layer is built from a kepler layer
 * class shared by every panel on the page, so it has no way to reach the panel
 * it is drawn in. The event bubbles from the canvas up to the panel's own
 * element, where `useMarkerSync` listens — each panel hears only its own drops.
 */

export const MARKER_DROP_EVENT = 'kepler-grafana:marker-drop';

export interface MarkerDropDetail {
  /** The kepler layer the marker belongs to. */
  layerId: string;
  markerId: string;
  position: LngLat;
}

interface Props {
  id: string;
  /** The kepler layer's id, echoed in a drop. */
  keplerLayerId: string;
  markers: MarkerSpec[];
  radiusPx: number;
  /** A glyph of the symbol layer's catalogue, or `circle` for the ringed dot. */
  symbol: string;
  /** Clockwise degrees an icon is turned by; the circle ignores it. */
  angleDegrees: number;
  visible: boolean;
}

/** What mjolnir.js hands an event-manager handler, narrowed to what is used. */
interface GestureEvent {
  type: string;
  offsetCenter: { x: number; y: number };
  /** From where the pointer went down; a pan starts only once it has moved past a threshold. */
  deltaX?: number;
  deltaY?: number;
  srcEvent?: { target?: EventTarget | null };
  stopImmediatePropagation(): void;
}

interface State extends Record<string, unknown> {
  handler: (event: GestureEvent) => void;
  /** The marker under the pointer while a drag is in progress. */
  dragging: { id: string; position: LngLat; grab: [number, number] } | null;
  /**
   * Where a marker was dropped, held until new props arrive — otherwise it
   * snaps back to its old spot for the frames between release and the panel
   * writing the new position into the layer.
   */
  dropped: { id: string; position: LngLat } | null;
}

const GESTURES = ['panstart', 'panmove', 'panend'];

/** Above the map controller, which listens at the default priority. */
const PRIORITY = 100;

type DeckContext = {
  deck?: {
    eventManager?: {
      on(type: string, handler: (event: GestureEvent) => void, opts: { priority: number }): void;
      off(type: string, handler: (event: GestureEvent) => void): void;
    };
    pickObject(opts: { x: number; y: number; radius: number; layerIds: string[] }): { object?: unknown } | null;
  };
  viewport: { unproject(xy: number[]): number[]; project(xyz: number[]): number[] };
};

export class DraggableMarkersLayer extends CompositeLayer<Props> {
  static layerName = 'DraggableMarkersLayer';
  static defaultProps = {
    keplerLayerId: '',
    markers: [],
    radiusPx: 10,
    symbol: 'circle',
    angleDegrees: 0,
  };

  declare state: State;

  private get deckContext(): DeckContext {
    return this.context as unknown as DeckContext;
  }

  initializeState(): void {
    // Bound once to whichever instance is current: deck builds a new layer per
    // render and moves the state across, and the listener must follow — the
    // same forwarding editable-layers does.
    const handler = (event: GestureEvent) => (this.getCurrentLayer() as DraggableMarkersLayer | null)?.onGesture(event);
    this.setState({ handler, dragging: null, dropped: null });
    const events = this.deckContext.deck?.eventManager;
    for (const type of GESTURES) {
      events?.on(type, handler, { priority: PRIORITY });
    }
  }

  finalizeState(): void {
    const events = this.deckContext.deck?.eventManager;
    for (const type of GESTURES) {
      events?.off(type, this.state.handler);
    }
  }

  updateState({ props, oldProps }: { props: Props; oldProps: Partial<Props> }): void {
    if (props.markers !== oldProps.markers && this.state.dropped) {
      this.setState({ dropped: null });
    }
  }

  onGesture(event: GestureEvent): void {
    const { dragging } = this.state;
    if (event.type === 'panstart') {
      if (!this.props.visible) {
        return;
      }
      // Where the pointer went down, not where it is: by the time the pan
      // starts it has already moved past the threshold.
      const x = event.offsetCenter.x - (event.deltaX ?? 0);
      const y = event.offsetCenter.y - (event.deltaY ?? 0);
      // A radius as wide as the marker: a catalogue glyph is often a thin
      // outline, and picking only hits the pixels it paints — grabbing the
      // middle of a pin's ring would otherwise pan the map instead.
      const picked = this.deckContext.deck?.pickObject({
        x,
        y,
        radius: Math.max(4, Math.round(this.props.radiusPx)),
        layerIds: [this.props.id],
      });
      const marker = picked?.object as MarkerSpec | undefined;
      if (!marker?.id || !marker.position) {
        return;
      }
      event.stopImmediatePropagation();
      // Where on the marker it was grabbed, in pixels from its anchor, so it
      // follows the pointer from there instead of jumping its anchor under it.
      const [ax, ay] = this.deckContext.viewport.project(marker.position);
      this.setState({ dragging: { id: marker.id, position: marker.position, grab: [x - ax, y - ay] } });
      return;
    }

    if (!dragging) {
      return;
    }
    event.stopImmediatePropagation();
    const position = this.pointerLngLat(event, dragging.grab) ?? dragging.position;

    if (event.type === 'panmove') {
      this.setState({ dragging: { ...dragging, position } });
      return;
    }

    // panend
    this.setState({ dragging: null, dropped: { id: dragging.id, position } });
    const detail: MarkerDropDetail = { layerId: this.props.keplerLayerId, markerId: dragging.id, position };
    event.srcEvent?.target?.dispatchEvent(new CustomEvent(MARKER_DROP_EVENT, { detail, bubbles: true }));
  }

  private pointerLngLat(event: GestureEvent, [gx, gy]: [number, number]): LngLat | null {
    const [lng, lat] = this.deckContext.viewport.unproject([event.offsetCenter.x - gx, event.offsetCenter.y - gy]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }

  /** The markers as drawn: the one being dragged, or just dropped, where the pointer left it. */
  private drawnMarkers(): MarkerSpec[] {
    const moved = this.state.dragging ?? this.state.dropped;
    return this.props.markers
      .map((marker) => (moved && marker.id === moved.id ? { ...marker, position: moved.position } : marker))
      .filter((marker) => marker.position !== null);
  }

  renderLayers() {
    const data = this.drawnMarkers();
    const moved = this.state.dragging ?? this.state.dropped;
    const trigger = [moved?.id, moved?.position?.[0], moved?.position?.[1]];
    const { radiusPx } = this.props;

    const getPosition = (marker: MarkerSpec) => marker.position as LngLat;
    const getColor = (marker: MarkerSpec) => [...marker.color, 255];
    const colorTrigger = data.map((m) => m.color.join());

    const handles =
      this.props.symbol === 'circle'
        ? new ScatterplotLayer<MarkerSpec>(
            this.getSubLayerProps({
              id: 'handles-circle',
              data,
              pickable: true,
              radiusUnits: 'pixels',
              getRadius: radiusPx,
              stroked: true,
              lineWidthUnits: 'pixels',
              getLineWidth: 2,
              getLineColor: [255, 255, 255, 255],
              getFillColor: getColor,
              getPosition,
              updateTriggers: { getPosition: trigger, getFillColor: colorTrigger },
            })
          )
        : // The symbol layer's own atlas and icon layer, so the glyphs are the
          // same ones and painted once for both. Facing the camera, unlike a
          // symbol: a marker has no bearing to keep on the ground.
          (buildSymbolDeckLayer(
            this.getSubLayerProps({
              // Not the circle's id: deck matches layers by id and hands the old
              // one's state to the new, so a scatterplot's state reaching an
              // icon layer — switching the symbol in the panel — crashes it with
              // "Cannot read properties of undefined (reading 'isLoaded')".
              id: 'handles-icon',
              data,
              pickable: true,
              symbols: [this.props.symbol],
              getIcon: () => this.props.symbol,
              billboard: true,
              getSize: radiusPx * 2.6,
              getAngle: deckAngle(this.props.angleDegrees, 'towards'),
              getColor,
              getPosition,
              updateTriggers: { getPosition: trigger, getColor: colorTrigger, getIcon: [this.props.symbol] },
            })
          ) as Layer | null);

    return [
      handles,
      new TextLayer<MarkerSpec>(
        this.getSubLayerProps({
          id: 'labels',
          data: data.filter((marker) => marker.label),
          getText: (marker: MarkerSpec) => marker.label,
          getPosition,
          sizeUnits: 'pixels',
          getSize: 13,
          fontWeight: 'bold',
          characterSet: 'auto',
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          getPixelOffset: [radiusPx + 5, 0],
          getColor: [30, 30, 30, 255],
          background: true,
          getBackgroundColor: [255, 255, 255, 230],
          backgroundPadding: [4, 2],
          updateTriggers: { getPosition: trigger },
        })
      ),
    ];
  }
}

/** Builds the deck layer — the factory `markersLayer.ts` is handed. */
export const buildMarkersDeckLayer = (props: Record<string, unknown>): unknown =>
  new DraggableMarkersLayer(props as unknown as Props);
