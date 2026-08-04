import { buildTripLayer } from './buildTripLayer';

/**
 * kepler's Trip layer reads two shapes: a `_geojson` column holding one
 * LineString per trip, or plain table columns it groups by id itself. The panel
 * builds the second, so the dataset keeps one row per GPS ping — and with it
 * every column the query returned, for tooltips, filters and colour.
 */
describe('buildTripLayer', () => {
  const roles = { tripId: 'track_id', latitude: 'lat', longitude: 'lng', time: 'tracked_at' };

  it('builds a table-mode layer pointing at the renamed columns', () => {
    const layer = buildTripLayer(roles, 'grafana-A');

    expect(layer).not.toBeNull();
    expect(layer?.type).toBe('trip');
    expect(layer?.config.dataId).toBe('grafana-A');
    expect(layer?.config.columnMode).toBe('table');
    // Not the source column names: `toKeplerRows` has already renamed them.
    expect(layer?.config.columns).toEqual({
      id: 'trip_id',
      lat: 'latitude',
      lng: 'longitude',
      timestamp: 'time',
    });
  });

  it('carries altitude only when the user mapped it', () => {
    expect(buildTripLayer({ ...roles, altitude: 'elevation' }, 'grafana-A')?.config.columns).toEqual({
      id: 'trip_id',
      lat: 'latitude',
      lng: 'longitude',
      timestamp: 'time',
      altitude: 'altitude',
    });
  });

  it('is parsed by kepler as a saved layer config', () => {
    // `visualChannels` is what marks the object as a config kepler must parse
    // rather than an already-built layer it should use verbatim.
    expect(buildTripLayer(roles, 'grafana-A')).toHaveProperty('visualChannels');
  });

  it('declines a query that does not describe trips', () => {
    expect(buildTripLayer({ latitude: 'lat', longitude: 'lng' }, 'grafana-A')).toBeNull();
    expect(buildTripLayer({ ...roles, time: undefined }, 'grafana-A')).toBeNull();
    expect(buildTripLayer({ ...roles, tripId: undefined }, 'grafana-A')).toBeNull();
  });
});
