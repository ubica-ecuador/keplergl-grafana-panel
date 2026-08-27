import { buildFlowField } from './buildFlowField';

describe('buildFlowField', () => {
  it('builds a components layer from u/v roles', () => {
    const layer = buildFlowField({ latitude: 'lat', longitude: 'lon', u: 'ugrd', v: 'vgrd' }, 'grafana-A');

    expect(layer).not.toBeNull();
    expect(layer!.type).toBe('flowfield');
    // Recognised as a saved-v1 layer config so kepler parses it.
    expect(layer!.visualChannels).toBeDefined();
    expect(layer!.config.columnMode).toBe('components');
    // Coordinates bind to the kepler names toKeplerRows renamed them to; the
    // velocity columns keep the query's own names, because nothing renames them.
    expect(layer!.config.columns).toEqual({ lat: 'latitude', lng: 'longitude', u: 'ugrd', v: 'vgrd' });
  });

  it('builds a polar layer from speed/direction roles', () => {
    const layer = buildFlowField(
      { latitude: 'lat', longitude: 'lon', speed: 'wind_speed_10m', direction: 'wind_direction_10m' },
      'grafana-A'
    );

    expect(layer!.config.columnMode).toBe('polar');
    expect(layer!.config.columns).toEqual({
      lat: 'latitude',
      lng: 'longitude',
      speed: 'wind_speed_10m',
      direction: 'wind_direction_10m',
    });
  });

  it('prefers components when the query supplies both spellings', () => {
    // Components need no convention to interpret, which is the order
    // `buildWindField` already applies when it reads the columns.
    const layer = buildFlowField(
      { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v', speed: 'speed', direction: 'direction' },
      'grafana-A'
    );

    expect(layer!.config.columnMode).toBe('components');
    expect(layer!.config.columns.speed).toBeUndefined();
  });

  it('carries the altitude column when the role is mapped', () => {
    const layer = buildFlowField(
      { latitude: 'lat', longitude: 'lon', u: 'u', v: 'v', altitude: 'level_m' },
      'grafana-A'
    );

    expect(layer!.config.columns.altitude).toBe('altitude');
  });

  it('leaves altitude out when the role is unmapped, so a level sits on the ground', () => {
    const layer = buildFlowField({ latitude: 'lat', longitude: 'lon', u: 'u', v: 'v' }, 'grafana-A');

    expect(layer!.config.columns.altitude).toBeUndefined();
  });

  it('refuses half a velocity pair, which describes nothing', () => {
    expect(buildFlowField({ latitude: 'lat', longitude: 'lon', u: 'u' }, 'grafana-A')).toBeNull();
    expect(buildFlowField({ latitude: 'lat', longitude: 'lon', speed: 'ws' }, 'grafana-A')).toBeNull();
  });

  it('refuses a query with no coordinates', () => {
    expect(buildFlowField({ u: 'u', v: 'v' }, 'grafana-A')).toBeNull();
  });
});
