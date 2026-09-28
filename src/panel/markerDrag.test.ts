import { MarkerDrag, markerDragFor } from './markerDrag';
import type { MarkerSpec } from './markers';

const marker = (id: string, position: [number, number] | null): MarkerSpec => ({
  id,
  label: id,
  color: [230, 57, 70],
  latVariable: '',
  lngVariable: '',
  position,
});

const markers = [marker('a', [-79, -2.9]), marker('b', [-78, -3])];

/** Two copies of the same layer: the one grabbed, and the one drawn above the basemap's roads. */
const below = { copy: 'below' };
const otherPane = { copy: 'right pane' };

describe('MarkerDrag', () => {
  it('draws the markers where the layer has them, leaving out any not yet placed', () => {
    const drag = new MarkerDrag();
    expect(drag.drawn([...markers, marker('c', null)]).map((m) => m.position)).toEqual([
      [-79, -2.9],
      [-78, -3],
    ]);
  });

  it('moves the dragged marker for every copy that draws from it', () => {
    const drag = new MarkerDrag();
    drag.start(below, 'b', [-78, -3]);
    expect(drag.move(below, [-78.5, -3.1])).toBe(true);

    // The copy above the roads reads the same drag without having handled a single event.
    expect(drag.drawn(markers).map((m) => m.position)).toEqual([
      [-79, -2.9],
      [-78.5, -3.1],
    ]);
  });

  it('leaves a gesture to the copy that started it', () => {
    // A split map draws the layer in both panes; a pointer moving over the
    // other pane while a marker is carried must not move it from there.
    const drag = new MarkerDrag();
    drag.start(below, 'a', [-79, -2.9]);

    expect(drag.move(otherPane, [0, 0])).toBe(false);
    expect(drag.drop(otherPane, [0, 0])).toBeNull();
    expect(drag.drawn(markers)[0].position).toEqual([-79, -2.9]);
  });

  it('keeps the last position when the pointer cannot be placed on the map', () => {
    const drag = new MarkerDrag();
    drag.start(below, 'a', [-79, -2.9]);
    drag.move(below, [-79.2, -2.8]);

    expect(drag.move(below, null)).toBe(true);
    expect(drag.drop(below, null)).toEqual({ id: 'a', position: [-79.2, -2.8] });
  });

  it('holds a dropped marker where it was left until the layer carries new markers', () => {
    const drag = new MarkerDrag();
    drag.start(below, 'a', [-79, -2.9]);
    expect(drag.drop(below, [-79.3, -2.7])).toEqual({ id: 'a', position: [-79.3, -2.7] });
    expect(drag.drawn(markers)[0].position).toEqual([-79.3, -2.7]);

    drag.markersChanged();
    expect(drag.drawn(markers)[0].position).toEqual([-79, -2.9]);
  });

  it('does not end a drag in progress when the layer is drawn again', () => {
    // kepler draws the layer again on every hover, each time with a new list.
    const drag = new MarkerDrag();
    drag.start(below, 'a', [-79, -2.9]);
    drag.move(below, [-79.1, -2.9]);

    drag.markersChanged();
    expect(drag.drawn(markers)[0].position).toEqual([-79.1, -2.9]);
    expect(drag.move(below, [-79.2, -2.9])).toBe(true);
  });

  it('forgets an earlier drop when a new drag starts', () => {
    const drag = new MarkerDrag();
    drag.start(below, 'a', [-79, -2.9]);
    drag.drop(below, [-79.3, -2.7]);
    drag.start(below, 'b', [-78, -3]);

    expect(drag.drawn(markers)[0].position).toEqual([-79, -2.9]);
  });

  it('tells its listeners each time what is drawn changes', () => {
    const drag = new MarkerDrag();
    const heard: string[] = [];
    const stop = drag.subscribe(() => heard.push(JSON.stringify(drag.moved())));

    drag.start(below, 'a', [-79, -2.9]);
    drag.move(below, [-79.1, -2.9]);
    drag.move(otherPane, [0, 0]);
    drag.drop(below, [-79.2, -2.9]);
    drag.markersChanged();
    drag.markersChanged();
    stop();
    drag.start(below, 'b', [-78, -3]);

    expect(heard).toEqual([
      '{"id":"a","position":[-79,-2.9]}',
      '{"id":"a","position":[-79.1,-2.9]}',
      '{"id":"a","position":[-79.2,-2.9]}',
      'null',
    ]);
  });
});

describe('markerDragFor', () => {
  it('hands every copy of a layer the same drag, and each layer its own', () => {
    const layer = {};
    const another = {};
    expect(markerDragFor(layer)).toBe(markerDragFor(layer));
    expect(markerDragFor(another)).not.toBe(markerDragFor(layer));
  });
});
