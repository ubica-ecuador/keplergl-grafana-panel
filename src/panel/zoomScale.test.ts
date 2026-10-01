import { currentZoomOf, MIN_ZOOM_FACTOR, noteZoom, zoomFactor } from './zoomScale';

describe('zoomFactor', () => {
  it('is 1 while the shrinking is off or the zoom is unknown', () => {
    expect(zoomFactor(3, null)).toBe(1);
    expect(zoomFactor(undefined, { refZoom: 10, scale: 1 })).toBe(1);
    expect(zoomFactor(NaN, { refZoom: 10, scale: 1 })).toBe(1);
  });

  it('halves per zoom level out at rate 1, and by √2 at rate 0.5', () => {
    expect(zoomFactor(9, { refZoom: 10, scale: 1 })).toBeCloseTo(0.5, 6);
    expect(zoomFactor(9, { refZoom: 10, scale: 0.5 })).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('never grows past the set size zooming in, nor shrinks below the floor zooming out', () => {
    expect(zoomFactor(15, { refZoom: 10, scale: 1 })).toBe(1);
    expect(zoomFactor(0, { refZoom: 10, scale: 1 })).toBe(MIN_ZOOM_FACTOR);
  });

  it('never changes at rate 0', () => {
    expect(zoomFactor(2, { refZoom: 10, scale: 0 })).toBe(1);
  });
});

describe('the zoom a layer was last drawn at', () => {
  it('is remembered per layer, to a tenth', () => {
    noteZoom('zoom-a', 7.4567);
    noteZoom('zoom-b', 12);

    expect(currentZoomOf('zoom-a')).toBe(7.5);
    expect(currentZoomOf('zoom-b')).toBe(12);
  });

  it('is unknown for a layer never drawn, and ignores a zoom that is not a number', () => {
    noteZoom('zoom-c', undefined);

    expect(currentZoomOf('zoom-c')).toBeNull();
  });
});
