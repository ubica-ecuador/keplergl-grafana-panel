import { FieldType, toDataFrame } from '@grafana/data';

import { buildSymbolLayer } from './buildSymbolLayer';
import { detectFields } from './detectFields';
import { framesToDatasets } from './framesToDatasets';
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

    // The channel name must exist in kepler's rows. Both channels are asserted
    // bound first: a channel left null would pass a name check vacuously, and
    // an unbound channel is exactly the defect this test exists for.
    const columnNames = new Set(toKeplerColumns(frame, roles).map((c) => c.name));
    const angleField = layer!.visualChannels.angleField as { name: string } | null;
    const sizeField = layer!.visualChannels.sizeField as { name: string } | null;

    expect(angleField).not.toBeNull();
    expect(sizeField).not.toBeNull();
    expect(columnNames.has(angleField!.name)).toBe(true);
    expect(columnNames.has(sizeField!.name)).toBe(true);
  });

  // Every name `count` claims, which renames its column to `count` in the rows.
  it.each(['count', 'trips', 'weight', 'flow', 'total', 'volume'])(
    'keeps the size channel bound when Magnitude is mapped by hand to a `%s` column that count also claims',
    (column) => {
      // Detection gives the column to `count`; the user maps it to Magnitude as
      // well. Roles are not exclusive, so the rows carry it renamed, and a
      // channel naming the query's own column would find nothing.
      const frame = toDataFrame({
        refId: 'A',
        fields: [
          { name: 'lat', type: FieldType.number, values: [-2.9, -0.19, -2.17] },
          { name: 'lon', type: FieldType.number, values: [-79.0, -78.48, -79.92] },
          { name: 'heading', type: FieldType.number, values: [0, 90, 180] },
          { name: column, type: FieldType.number, values: [10, 20, 30] },
        ],
      });

      const [dataset] = framesToDatasets([frame], { A: { magnitude: column } });
      const sizeField = dataset.symbolLayer?.visualChannels.sizeField as { name: string } | null | undefined;

      expect(sizeField).toBeTruthy();
      expect(Object.keys(dataset.rows[0])).toContain(sizeField!.name);
      expect(dataset.rows.map((row) => row[sizeField!.name])).toEqual([10, 20, 30]);
    }
  );
});
