import { viewportFromMapState } from './windViewport';

describe('viewportFromMapState', () => {
  it('covers the whole world at zoom 0 on a 512-pixel map', () => {
    // Web Mercator's world is one 512-pixel tile at zoom 0, which is the scale
    // deck.gl and kepler use. Getting the tile size wrong shifts every extent
    // by a factor of two and the streamlines seed in the wrong place.
    const viewport = viewportFromMapState({ latitude: 0, longitude: 0, zoom: 0, width: 512, height: 512 })!;

    expect(viewport.west).toBeCloseTo(-180, 3);
    expect(viewport.east).toBeCloseTo(180, 3);
    // Mercator cannot reach the poles; the square world tops out near ±85.05°.
    expect(viewport.north).toBeCloseTo(85.051, 2);
    expect(viewport.south).toBeCloseTo(-85.051, 2);
  });

  it('halves the span for every zoom level', () => {
    const at = (zoom: number) => viewportFromMapState({ latitude: 0, longitude: -78, zoom, width: 800, height: 600 })!;

    const span = (zoom: number) => at(zoom).east - at(zoom).west;

    expect(span(4) / span(5)).toBeCloseTo(2, 6);
    expect(at(5).west + at(5).east).toBeCloseTo(-156, 6); // sigue centrado en -78
  });

  it('carries the pixel size through, since the step length depends on it', () => {
    const viewport = viewportFromMapState({ latitude: -1.5, longitude: -78, zoom: 6, width: 1280, height: 720 })!;

    expect(viewport.widthPx).toBe(1280);
    expect(viewport.heightPx).toBe(720);
  });

  it('returns null for a map state that is not ready yet', () => {
    // kepler reports a zero-sized map before layout settles, and dividing by it
    // would produce an infinite extent.
    expect(viewportFromMapState({ latitude: 0, longitude: 0, zoom: 5, width: 0, height: 0 })).toBeNull();
    expect(viewportFromMapState(undefined)).toBeNull();
  });
});
