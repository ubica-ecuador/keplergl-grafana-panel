import { DEFAULT_LAYER_GROUPS } from '@kepler.gl/constants';

import { CARTO_DARK_MATTER_LAYERS, OPENFREEMAP_LIBERTY_LAYERS, UPPER_CASE_LAYERS } from './basemapStyleFixtures';
import {
  isPointOfInterest,
  SATELLITE_LAYER_GROUPS,
  STYLE_LAYER_GROUPS,
  slugsMatching,
  type StyleLayer,
} from './layerGroups';

describe('the layer groups, case-insensitive', () => {
  it("keeps kepler's slugs and order, with points of interest after labels", () => {
    // A rename upstream shows up here rather than as an inert switch.
    const kepler = DEFAULT_LAYER_GROUPS.map((g) => g.slug);
    expect(STYLE_LAYER_GROUPS.map((g) => g.slug)).toEqual([kepler[0], 'poi', ...kepler.slice(1)]);
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

describe('points of interest', () => {
  const slugsOf = (layers: StyleLayer[], id: string) =>
    slugsMatching(
      STYLE_LAYER_GROUPS,
      layers.find((l) => l.id === id)!
    );

  it('come right after labels', () => {
    expect(STYLE_LAYER_GROUPS.map((g) => g.slug).slice(0, 3)).toEqual(['label', 'poi', 'road']);
  });

  it('take the symbols of the poi source layer away from labels', () => {
    // kepler's label group catches every symbol: left there, turning labels off would hide POIs too.
    expect(slugsOf(OPENFREEMAP_LIBERTY_LAYERS, 'poi_r1')).toEqual(['poi']);
    expect(slugsOf(CARTO_DARK_MATTER_LAYERS, 'poi_stadium')).toEqual(['poi']);
    expect(slugsOf(UPPER_CASE_LAYERS, 'Station')).toEqual(['poi']);
  });

  it('leave place names with labels', () => {
    // CARTO's `roadname_minor` falls into label *and* road, as in kepler: its road filter only excludes ids with "label".
    expect(slugsOf(OPENFREEMAP_LIBERTY_LAYERS, 'label_city')).toEqual(['label']);
    expect(slugsOf(CARTO_DARK_MATTER_LAYERS, 'place_city_r6')).toEqual(['label']);
  });

  it('are symbols only: a circle on the poi source layer is not one', () => {
    expect(isPointOfInterest({ id: 'poi-dots', type: 'circle', 'source-layer': 'poi' })).toBe(false);
  });
});
