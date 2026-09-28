import { exposeTransform } from './markersAboveTopMap';

/**
 * deck.gl 9.3 draws into a MapLibre map reading `map.transform` — its size, its
 * near and far planes. MapLibre 6 moved the transform to `map._camera`, and
 * deck then throws on every frame. These are the three shapes a map arrives in.
 */
describe('exposeTransform', () => {
  it('leaves a map that still has its transform alone', () => {
    const transform = { height: 512 };
    const map = { transform, _camera: { transform: { height: 0 } } };

    expect(exposeTransform(map)).toBe(true);
    expect(map.transform).toBe(transform);
  });

  it('gives a MapLibre 6 map its camera’s transform, following the camera when it swaps it', () => {
    const camera = { transform: { height: 512 } };
    const map: Record<string, any> = { _camera: camera };

    expect(exposeTransform(map)).toBe(true);
    expect(map.transform.height).toBe(512);

    // MapLibre builds a new transform when the projection changes.
    camera.transform = { height: 300 };
    expect(map.transform.height).toBe(300);
  });

  it('says so when there is no transform to be found', () => {
    expect(exposeTransform({})).toBe(false);
    expect(exposeTransform({ _camera: {} })).toBe(false);
  });
});
