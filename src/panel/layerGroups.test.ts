import { DEFAULT_LAYER_GROUPS } from '@kepler.gl/constants';
import KeplerGlSchema from '@kepler.gl/schemas';

import { CARTO_DARK_MATTER_LAYERS, OPENFREEMAP_LIBERTY_LAYERS, UPPER_CASE_LAYERS } from './basemapStyleFixtures';
import {
  isPointOfInterest,
  layerGroupsIn,
  poiFollowsSavedLabel,
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

describe('3D buildings', () => {
  it("are the style's own extrusions, and the flat footprints are not", () => {
    const of = (id: string) =>
      slugsMatching(
        STYLE_LAYER_GROUPS,
        OPENFREEMAP_LIBERTY_LAYERS.find((l) => l.id === id)!
      );
    expect(of('building-3d')).toEqual(['3d building']);
    expect(of('building')).toEqual(['building']);
  });

  it('get no switch on a style without extrusions, CARTO among them', () => {
    // kepler's own 3D buildings come from Mapbox and need a token the free panel does not have.
    const slugsIn = (layers: StyleLayer[]) => layerGroupsIn(STYLE_LAYER_GROUPS, { layers }).map((g) => g.slug);
    expect(slugsIn(CARTO_DARK_MATTER_LAYERS)).not.toContain('3d building');
    expect(slugsIn(OPENFREEMAP_LIBERTY_LAYERS)).toContain('3d building');
  });

  it("start on, and offer no colour picker — it paints only kepler's Mapbox buildings", () => {
    const group = STYLE_LAYER_GROUPS.find((g) => g.slug === '3d building')!;
    expect(group.defaultVisibility).toBe(true);
    expect(group.isColorPickerAvailable).toBe(false);
  });
});

describe('a config saved before the Points of interest switch existed', () => {
  // kepler's label group caught every symbol, points of interest included, so a
  // map saved with labels off hid them too, and labels on top drew them on top.
  const saved = (mapStyle: Record<string, unknown>) => ({
    mapStyle: { styleType: 'dark-matter', ...mapStyle } as Record<string, unknown>,
  });

  it('gives points of interest the state labels had', () => {
    const config = poiFollowsSavedLabel(
      saved({ visibleLayerGroups: { label: false, road: true }, topLayerGroups: { label: true } })
    );
    expect(config.mapStyle.visibleLayerGroups).toEqual({ label: false, poi: false, road: true });
    expect(config.mapStyle.topLayerGroups).toEqual({ label: true, poi: true });
  });

  it("reads the shape kepler's own parser hands back", () => {
    const parsed = KeplerGlSchema.parseSavedConfig({
      version: 'v1',
      config: { mapStyle: { styleType: 'dark-matter', visibleLayerGroups: { label: false, road: true } } },
    } as never);
    expect(poiFollowsSavedLabel(parsed)?.mapStyle?.visibleLayerGroups).toMatchObject({ label: false, poi: false });
  });

  it('adds no switch states the config did not have', () => {
    const config = poiFollowsSavedLabel(saved({ visibleLayerGroups: { label: false } }));
    expect(config.mapStyle).not.toHaveProperty('topLayerGroups');
  });

  it('leaves a config that already names points of interest alone', () => {
    const config = saved({ visibleLayerGroups: { label: false, poi: true } });
    expect(poiFollowsSavedLabel(config)).toBe(config);
  });

  it('leaves configs without labels, map style or config alone', () => {
    const noLabel = saved({ visibleLayerGroups: { road: false } });
    expect(poiFollowsSavedLabel(noLabel)).toBe(noLabel);
    const noStyle = { visState: {} };
    expect(poiFollowsSavedLabel(noStyle)).toBe(noStyle);
    expect(poiFollowsSavedLabel(null)).toBeNull();
  });
});
