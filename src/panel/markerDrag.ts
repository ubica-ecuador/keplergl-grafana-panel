import type { LngLat, MarkerSpec } from './markers';

/**
 * A marker drag, shared by every deck copy of one markers layer.
 *
 * A markers layer is drawn twice when the basemap keeps roads or labels above
 * the data: once in kepler's deck, where the pointer reaches it and the drag
 * happens, and once more above the basemap's top map, which takes no pointer
 * events at all (`markersOnTop.tsx`). Both copies have to show the marker under
 * the pointer, so where it is being carried cannot live in either deck layer's
 * own state — it lives here, one per kepler layer, and both draw from it.
 *
 * The same kepler layer also serves both panes of a split map. Each pane's copy
 * listens to its own pointer, so a gesture belongs to the copy that started it:
 * the others draw the move and never take part in it.
 *
 * Free of deck, so every rule is tested with literal values.
 */

export interface MovedMarker {
  id: string;
  position: LngLat;
}

export class MarkerDrag {
  private dragging: (MovedMarker & { owner: object }) | null = null;
  /**
   * Where a marker was dropped, held until the layer carries new markers —
   * otherwise it snaps back to its old spot for the frames between release and
   * the panel writing the new position into the layer.
   */
  private dropped: MovedMarker | null = null;
  private listeners = new Set<() => void>();

  /** The marker drawn off its place: being carried, or just dropped. */
  moved(): MovedMarker | null {
    if (this.dragging) {
      return { id: this.dragging.id, position: this.dragging.position };
    }
    return this.dropped;
  }

  /** The markers as drawn: the moved one where the pointer has it, and only those placed. */
  drawn(markers: MarkerSpec[]): MarkerSpec[] {
    const moved = this.moved();
    return markers
      .map((marker) => (moved && marker.id === moved.id ? { ...marker, position: moved.position } : marker))
      .filter((marker) => marker.position !== null);
  }

  start(owner: object, id: string, position: LngLat): void {
    this.dragging = { owner, id, position };
    this.dropped = null;
    this.notify();
  }

  /**
   * Carries the marker to `position`, or keeps it where it is when the pointer
   * could not be placed on the map. False when the drag is not `owner`'s: the
   * event is then none of its business.
   */
  move(owner: object, position: LngLat | null): boolean {
    if (this.dragging?.owner !== owner) {
      return false;
    }
    if (position) {
      this.dragging = { ...this.dragging, position };
      this.notify();
    }
    return true;
  }

  /** Ends `owner`'s drag and says where the marker was left; null when the drag was not its. */
  drop(owner: object, position: LngLat | null): MovedMarker | null {
    if (!this.dragging || this.dragging.owner !== owner) {
      return null;
    }
    this.dropped = { id: this.dragging.id, position: position ?? this.dragging.position };
    this.dragging = null;
    this.notify();
    return this.dropped;
  }

  /** The layer carries a new list of markers: a drop has been written into it, or overruled. */
  markersChanged(): void {
    if (this.dropped && !this.dragging) {
      this.dropped = null;
      this.notify();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const drags = new WeakMap<object, MarkerDrag>();

/**
 * The drag of a kepler layer, by the layer object — the one thing both deck
 * copies share. Not by id: every panel on a dashboard has its own store, and
 * layer ids repeat across them.
 */
export function markerDragFor(layer: object): MarkerDrag {
  let drag = drags.get(layer);
  if (!drag) {
    drag = new MarkerDrag();
    drags.set(layer, drag);
  }
  return drag;
}
