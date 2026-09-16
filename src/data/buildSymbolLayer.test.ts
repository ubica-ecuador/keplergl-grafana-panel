import { buildSymbolLayer } from './buildSymbolLayer';

describe('buildSymbolLayer', () => {
  it('binds the rotation column as a visual channel, by name', () => {
    const layer = buildSymbolLayer(
      { latitude: 'lat', longitude: 'lon', rotation: 'heading', magnitude: 'speed' },
      'grafana-A'
    );

    expect(layer).not.toBeNull();
    expect(layer!.type).toBe('symbol');
    // Coordinates bind to the names `toKeplerRows` renamed them to.
    expect(layer!.config.columns).toEqual({ lat: 'latitude', lng: 'longitude' });
    // kepler's merger matches a saved channel by name alone, so the type is
    // informational — but the shape has to be the one its schema writes.
    expect(layer!.visualChannels).toMatchObject({
      angleField: { name: 'heading' },
      angleScale: 'linear',
      sizeField: { name: 'speed' },
      sizeScale: 'sqrt',
    });
  });

  it('reads a meteorological direction as where the wind comes from', () => {
    // 180 degrees of difference, and both readings look right on a map.
    const layer = buildSymbolLayer(
      { latitude: 'lat', longitude: 'lon', direction: 'wind_direction', speed: 'wind_speed' },
      'grafana-A'
    );

    expect(layer!.config.visConfig.directionConvention).toBe('from');
    expect(layer!.visualChannels.angleField).toMatchObject({ name: 'wind_direction' });
  });

  it('reads a vehicle\'s heading as where it goes', () => {
    const layer = buildSymbolLayer({ latitude: 'lat', longitude: 'lon', rotation: 'course' }, 'grafana-A');

    expect(layer!.config.visConfig.directionConvention).toBe('towards');
  });

  it('draws unturned symbols when only coordinates are mapped', () => {
    const layer = buildSymbolLayer({ latitude: 'lat', longitude: 'lon' }, 'grafana-A');

    expect(layer).not.toBeNull();
    expect(layer!.visualChannels.angleField).toBeNull();
  });

  it('builds nothing without coordinates', () => {
    expect(buildSymbolLayer({ rotation: 'heading' }, 'grafana-A')).toBeNull();
  });

  it('carries the altitude column when one is mapped', () => {
    const layer = buildSymbolLayer({ latitude: 'lat', longitude: 'lon', altitude: 'elev' }, 'grafana-A');

    expect(layer!.config.columns).toEqual({ lat: 'latitude', lng: 'longitude', altitude: 'altitude' });
  });
});
