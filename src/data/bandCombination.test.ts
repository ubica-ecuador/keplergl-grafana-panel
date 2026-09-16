import { BAND_COMBINATIONS, resolveBandCombination } from './bandCombination';

describe('resolveBandCombination', () => {
  it('defaults to true colour when nothing is set', () => {
    expect(resolveBandCombination(undefined)).toBe('trueColor');
    expect(resolveBandCombination('')).toBe('trueColor');
    expect(resolveBandCombination('   ')).toBe('trueColor');
  });

  it('degrades an unknown value to true colour rather than drawing nothing', () => {
    expect(resolveBandCombination('burn')).toBe('trueColor');
    expect(resolveBandCombination('$bands')).toBe('trueColor');
  });

  it('accepts the five combinations, ignoring surrounding space', () => {
    expect(resolveBandCombination(' forestBurn ')).toBe('forestBurn');
    expect(resolveBandCombination('infrared')).toBe('infrared');
    expect(resolveBandCombination('nbr')).toBe('nbr');
    expect(resolveBandCombination('ndmi')).toBe('ndmi');
    expect(resolveBandCombination('trueColor')).toBe('trueColor');
  });
});

describe('BAND_COMBINATIONS', () => {
  it('leaves true colour on the path that already works', () => {
    expect(BAND_COMBINATIONS.trueColor).toEqual({ source: 'visual', renderer: 'kepler' });
  });

  it('paints the composites on the server, in RGB order, with one stretch per asset', () => {
    const burn = BAND_COMBINATIONS.forestBurn;
    expect(burn.source).toBe('item');
    expect(burn.renderer).toBe('painted');
    expect(burn.assets).toEqual(['swir22', 'nir', 'blue']);
    expect(burn.rescale).toHaveLength(burn.assets!.length);

    const infrared = BAND_COMBINATIONS.infrared;
    expect(infrared.assets).toEqual(['nir', 'red', 'green']);
    expect(infrared.rescale).toHaveLength(3);
  });

  it('hands the indices to kepler, each with a ramp', () => {
    // TiTiler rejects `expression` on this deployment, so an index cannot be a
    // single painted request — kepler fetches the two bands and colours them.
    expect(BAND_COMBINATIONS.nbr).toEqual({ source: 'item', renderer: 'kepler', preset: 'nbr', colormap: 'rdylgn' });
    expect(BAND_COMBINATIONS.ndmi).toEqual({ source: 'item', renderer: 'kepler', preset: 'ndmi', colormap: 'rdylbu' });
  });

  it('never asks the server to paint without telling it what to paint', () => {
    for (const recipe of Object.values(BAND_COMBINATIONS)) {
      if (recipe.renderer === 'painted') {
        expect(recipe.assets?.length).toBeGreaterThan(0);
      } else {
        expect(recipe.assets).toBeUndefined();
      }
    }
  });
});
