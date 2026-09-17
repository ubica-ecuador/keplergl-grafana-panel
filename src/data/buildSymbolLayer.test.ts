import { FieldType, toDataFrame } from '@grafana/data';

import { buildSymbolLayer } from './buildSymbolLayer';
import { detectFields } from './detectFields';
import { toKeplerColumns } from './toKeplerDataset';

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

  it('reads a direction with no wind speed beside it as where it goes', () => {
    // A vehicle table's `direction` column in degrees: the `direction` role
    // claims it by name, but nothing says it is a wind, and reading it as one
    // turns every arrow half round.
    const layer = buildSymbolLayer({ latitude: 'lat', longitude: 'lon', direction: 'direction' }, 'grafana-A');

    expect(layer!.visualChannels.angleField).toMatchObject({ name: 'direction' });
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

  it('prefers rotation over direction when both are mapped', () => {
    const layer = buildSymbolLayer(
      { latitude: 'lat', longitude: 'lon', rotation: 'heading', direction: 'wind_dir' },
      'grafana-A'
    );

    expect(layer!.visualChannels.angleField).toMatchObject({ name: 'heading' });
    expect(layer!.config.visConfig.directionConvention).toBe('towards');
  });
});

describe('buildSymbolLayer — integration: detectFields → toKeplerRows → buildSymbolLayer', () => {
  it('binds a magnitude channel to a column that exists in kepler\'s rows', () => {
    // The chain that was missing: magnitude must not land in count's renamed
    // column pool. This test catches the collision by verifying that the bound
    // channel name exists in the actual rows.
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [-2.9, -2.8] },
        { name: 'lon', type: FieldType.number, values: [-79.0, -78.9] },
        { name: 'bearing', type: FieldType.number, values: [0, 90] },
        { name: 'magnitude', type: FieldType.number, values: [10, 20] },
      ],
    });

    const roles = detectFields(frame);
    expect(roles.rotation).toBe('bearing');
    expect(roles.magnitude).toBe('magnitude');

    const layer = buildSymbolLayer(roles, 'test-data');
    expect(layer).not.toBeNull();

    // The channel name must exist in kepler's rows.
    const keplerColumns = toKeplerColumns(frame, roles);
    const columnNames = new Set(keplerColumns.map((c) => c.name));

    const angleFieldName = (layer!.visualChannels.angleField as { name: string } | null)?.name;
    const sizeFieldName = (layer!.visualChannels.sizeField as { name: string } | null)?.name;

    if (angleFieldName) {
      expect(columnNames.has(angleFieldName)).toBe(true);
    }
    if (sizeFieldName) {
      expect(columnNames.has(sizeFieldName)).toBe(true);
    }
  });
});
