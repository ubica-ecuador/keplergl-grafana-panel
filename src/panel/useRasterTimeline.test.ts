import type { RasterDataset } from '../data/rasterDataset';
import { rasterDressKey } from './useRasterTimeline';

function raster(overrides: Partial<RasterDataset>): RasterDataset {
  return {
    id: 'grafana-A-raster',
    label: 'A',
    kind: 'stac',
    sourceUrl: 'https://item',
    metadataUrl: 'https://item',
    tileServerUrls: ['https://titiler.test'],
    scenes: [],
    ...overrides,
  };
}

describe('rasterDressKey', () => {
  it('gives no key before the layer exists yet, so nothing is dispatched too early', () => {
    expect(rasterDressKey(raster({ preset: 'nbr', colormap: 'rdylgn' }), null)).toBeNull();
  });

  it('gives no key for a raster with no style of its own — true colour, nothing to dress', () => {
    expect(rasterDressKey(raster({ kind: 'cog', preset: undefined, colormap: undefined }), 'layer-1')).toBeNull();
  });

  it('gives no key for an archive, even one that somehow carried a colormap', () => {
    // Archives arrive as finished pictures; kepler's colormap has nothing to
    // act on regardless of what the raster's own fields say.
    expect(rasterDressKey(raster({ kind: 'pmtiles', colormap: 'blues' }), 'layer-1')).toBeNull();
  });

  it('gives no key for a painted composite, even one that somehow carried a colormap', () => {
    expect(rasterDressKey(raster({ kind: 'painted', colormap: 'blues' }), 'layer-1')).toBeNull();
  });

  it('gives a key once a layer exists and the raster carries a style', () => {
    expect(rasterDressKey(raster({ preset: 'nbr', colormap: 'rdylgn' }), 'layer-1')).toBe('layer-1|nbr|rdylgn');
  });

  it('gives the same key again for the same raster and layer, so a reconcile with nothing changed does not redress', () => {
    const nbr = raster({ preset: 'nbr', colormap: 'rdylgn' });

    const dressed = new Set<string>();
    const first = rasterDressKey(nbr, 'layer-1');
    expect(first).not.toBeNull();
    dressed.add(first as string);

    // A later reconcile, same raster, same layer — the ordinary case, which
    // happens on every store change until something actually moves.
    const second = rasterDressKey(nbr, 'layer-1');
    expect(second).toBe(first);
    expect(dressed.has(second as string)).toBe(true);
  });

  it('gives a different key when the band combination changes the preset and ramp, so the new style is not skipped as already dressed', () => {
    const dressed = new Set<string>();
    const nbrKey = rasterDressKey(raster({ preset: 'nbr', colormap: 'rdylgn' }), 'layer-1');
    dressed.add(nbrKey as string);

    // The user (or a dashboard variable) switches the dropdown from NBR to
    // NDMI on the same query: same layer, different style.
    const ndmiKey = rasterDressKey(raster({ preset: 'ndmi', colormap: 'rdylbu' }), 'layer-1');

    expect(ndmiKey).not.toBe(nbrKey);
    expect(dressed.has(ndmiKey as string)).toBe(false);
  });
});
