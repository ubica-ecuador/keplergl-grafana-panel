import KeplerGlSchema from '@kepler.gl/schemas';

import legacyConfig from './__fixtures__/kepler-v1-saved-config.json';
import { parseMapConfigJson } from './mapConfig';

/**
 * Characterisation test for configs produced by older kepler.gl releases.
 *
 * The panel invites users to paste configs exported from kepler.gl, Foursquare
 * Studio or Dekart — and Dekart is still on kepler 3.2.6. This pins whether the
 * pinned 3.3.0-alpha.3 can still read those, so a regression in kepler's
 * migration path shows up here rather than as a broken paste in someone's
 * dashboard.
 *
 * The fixture is a real `v1` saved config lifted from kepler.gl's own test
 * suite (`test/fixtures/state-saved-v1-1.js`, MIT).
 */
describe('a saved config from an older kepler', () => {
  it('is recognised by the paste parser', () => {
    expect(parseMapConfigJson(JSON.stringify(legacyConfig))).toEqual(legacyConfig);
  });

  it('survives parseSavedConfig with its layers and filter intact', () => {
    const parsed = KeplerGlSchema.parseSavedConfig(legacyConfig);

    expect(parsed).not.toBeNull();
    expect(parsed?.visState?.layers).toHaveLength(2);
    expect(parsed?.visState?.filters).toHaveLength(1);
  });

  it('keeps the layer types, so the map is not silently rebuilt as something else', () => {
    const parsed = KeplerGlSchema.parseSavedConfig(legacyConfig);

    expect(parsed?.visState?.layers?.map((l: { type: string }) => l.type)).toEqual(['geojson', 'geojson']);
  });

  it('keeps the saved viewport', () => {
    const parsed = KeplerGlSchema.parseSavedConfig(legacyConfig);

    expect(parsed?.mapState).toMatchObject({
      latitude: legacyConfig.config.mapState.latitude,
      longitude: legacyConfig.config.mapState.longitude,
    });
  });
});
