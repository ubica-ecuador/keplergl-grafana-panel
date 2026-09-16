import { buildSymbolDeckLayer } from './symbolDeckLayer';

/**
 * jsdom has no canvas backend and `.config/jest-setup.js` stubs `getContext`
 * to return nothing — the same case a browser hits when it has run out of 2D
 * contexts. That makes this a free, faithful test of the failure path.
 */
describe('buildSymbolDeckLayer', () => {
  it('degrades to null instead of throwing when there is no 2D context', () => {
    expect(buildSymbolDeckLayer({ symbols: ['arrow'] })).toBeNull();
  });

  it('keeps trying on the next call rather than caching the failure as success', () => {
    buildSymbolDeckLayer({ symbols: ['arrow'] });
    expect(buildSymbolDeckLayer({ symbols: ['arrow'] })).toBeNull();
  });
});
