import { buildVectorFieldDeckLayer } from './vectorFieldDeckLayer';

/**
 * jsdom has no real canvas backend, and `.config/jest-setup.js` stubs
 * `HTMLCanvasElement.prototype.getContext` to return nothing — exactly the
 * "cannot paint the atlas" case a browser hits when it has run out of 2D
 * contexts, or serves one that refuses `getContext('2d')`. That makes this
 * environment a free, faithful test of the failure path, with no DOM mocking
 * of our own.
 */
describe('buildVectorFieldDeckLayer', () => {
  it('degrades to null instead of throwing when there is no 2D context to paint the atlas into', () => {
    expect(buildVectorFieldDeckLayer({})).toBeNull();
  });

  it('keeps trying on the next call rather than caching the failure as success', () => {
    buildVectorFieldDeckLayer({});
    expect(buildVectorFieldDeckLayer({})).toBeNull();
  });
});
