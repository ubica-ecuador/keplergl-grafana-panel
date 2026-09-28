import { CompositeLayer, Layer } from '@deck.gl/core';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import { MarkerDrag } from './markerDrag';
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
 *
 * **Why the drag is not in this layer's state.** Over a basemap that keeps its
 * roads above the data, the layer is drawn a second time above them
 * (`markersOnTop.tsx`), in a deck that takes no pointer events. This copy, the
 * one in kepler's deck, is still the one grabbed; the one above only draws. Both
 * read the marker's position mid-drag from the `MarkerDrag` of their kepler
 * layer, and each redraws when it changes.
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
  /** Shared by every copy of the kepler layer; see `markerDrag.ts`. */
  drag: MarkerDrag | null;
  /** False in the copy drawn above the basemap: it neither listens to the pointer nor picks. */
  interactive: boolean;
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
  /** Bound once and carried from layer to layer: what the event manager and the drag know this copy by. */
  handler: (event: GestureEvent) => void;
  /** Redraws the current layer when the drag moves, whichever copy moved it. */
  redraw: () => void;
  unsubscribe: () => void;
  /** Stands in for a missing `drag` prop, so a lone layer still drags. */
  ownDrag: MarkerDrag;
  /**
   * Where on the marker this copy grabbed it, in pixels from its anchor, so it
   * follows the pointer from there instead of jumping its anchor under it.
   * Null unless the gesture in progress is this copy's.
   */
  grab: [number, number] | null;
  /** The drag's moved marker when last heard: changing it is what makes deck draw again. */
  moved: unknown;
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
    drag: null,
    interactive: true,
  };

  declare state: State;

  private get deckContext(): DeckContext {
    return this.context as unknown as DeckContext;
  }

  private get drag(): MarkerDrag {
    return this.props.drag ?? this.state.ownDrag;
  }

  initializeState(): void {
    // Bound once to whichever instance is current: deck builds a new layer per
    // render and moves the state across, and the listener must follow — the
    // same forwarding editable-layers does.
    const current = () => this.getCurrentLayer() as DraggableMarkersLayer | null;
    const handler = (event: GestureEvent) => current()?.onGesture(event);
    const redraw = () => {
      const layer = current();
      layer?.setState({ moved: layer.drag.moved() });
    };
    this.setState({ handler, redraw, ownDrag: new MarkerDrag(), grab: null, moved: null });
    this.setState({ unsubscribe: this.drag.subscribe(redraw) });
    if (!this.props.interactive) {
      return;
    }
    const events = this.deckContext.deck?.eventManager;
    for (const type of GESTURES) {
      events?.on(type, handler, { priority: PRIORITY });
    }
  }

  finalizeState(): void {
    this.state.unsubscribe();
    const events = this.deckContext.deck?.eventManager;
    for (const type of GESTURES) {
      events?.off(type, this.state.handler);
    }
  }

  updateState({ props, oldProps }: { props: Props; oldProps: Partial<Props> }): void {
    if (props.drag !== oldProps.drag) {
      this.state.unsubscribe();
      this.setState({ unsubscribe: this.drag.subscribe(this.state.redraw) });
    }
    if (props.markers !== oldProps.markers) {
      this.drag.markersChanged();
    }
  }

  onGesture(event: GestureEvent): void {
    const { grab, handler } = this.state;
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
      const [ax, ay] = this.deckContext.viewport.project(marker.position);
      this.setState({ grab: [x - ax, y - ay] });
      this.drag.start(handler, marker.id, marker.position);
      return;
    }

    if (!grab) {
      return;
    }
    const position = this.pointerLngLat(event, grab);

    if (event.type === 'panmove') {
      if (this.drag.move(handler, position)) {
        event.stopImmediatePropagation();
      }
      return;
    }

    // panend
    this.setState({ grab: null });
    const dropped = this.drag.drop(handler, position);
    if (!dropped) {
      return;
    }
    event.stopImmediatePropagation();
    const detail: MarkerDropDetail = {
      layerId: this.props.keplerLayerId,
      markerId: dropped.id,
      position: dropped.position,
    };
    event.srcEvent?.target?.dispatchEvent(new CustomEvent(MARKER_DROP_EVENT, { detail, bubbles: true }));
  }

  private pointerLngLat(event: GestureEvent, [gx, gy]: [number, number]): LngLat | null {
    const [lng, lat] = this.deckContext.viewport.unproject([event.offsetCenter.x - gx, event.offsetCenter.y - gy]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }

  renderLayers() {
    const data = this.drag.drawn(this.props.markers);
    const moved = this.drag.moved();
    const trigger = [moved?.id, moved?.position?.[0], moved?.position?.[1]];
    const { radiusPx, interactive } = this.props;

    const getPosition = (marker: MarkerSpec) => marker.position as LngLat;
    const getColor = (marker: MarkerSpec) => [...marker.color, 255];
    const colorTrigger = data.map((m) => m.color.join());

    const handles =
      this.props.symbol === 'circle'
        ? new ScatterplotLayer<MarkerSpec>(
            this.getSubLayerProps({
              id: 'handles-circle',
              data,
              pickable: interactive,
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
              pickable: interactive,
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
