import { DEFAULT_LAYER_GROUPS } from '@kepler.gl/constants';

import { UPPER_CASE_LAYERS } from './basemapStyleFixtures';
import { SATELLITE_LAYER_GROUPS, STYLE_LAYER_GROUPS, slugsMatching } from './layerGroups';

describe('the layer groups, case-insensitive', () => {
  it("keeps kepler's slugs and order", () => {
    // A rename upstream shows up here rather than as an inert switch.
    expect(STYLE_LAYER_GROUPS.map((g) => g.slug)).toEqual(DEFAULT_LAYER_GROUPS.map((g) => g.slug));
  });

  it('finds upper-case ids the way kepler finds lower-case ones', () => {
    const byId = Object.fromEntries(UPPER_CASE_LAYERS.map((l) => [l.id, slugsMatching(STYLE_LAYER_GROUPS, l)]));
    expect(byId['Water']).toEqual(['water']);
    expect(byId['Road network']).toEqual(['road']);
    expect(byId['Building']).toEqual(['building']);
    expect(byId['Place labels']).toEqual(['label']);
    expect(byId['Background']).toEqual([]);
  });

  it('still agrees with kepler on lower-case ids', () => {
    for (const id of ['water', 'road-primary', 'admin-boundary', 'building', 'landcover', 'place-city']) {
      const kepler = DEFAULT_LAYER_GROUPS.filter((g) => Boolean(g.filter({ id, type: 'line' } as never))).map(
        (g) => g.slug
      );
      expect(slugsMatching(STYLE_LAYER_GROUPS, { id, type: 'line' })).toEqual(kepler);
    }
  });

  it('gives the satellite overlays label and road only', () => {
    expect(SATELLITE_LAYER_GROUPS.map((g) => g.slug)).toEqual(['label', 'road']);
  });
});
