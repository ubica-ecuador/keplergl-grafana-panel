import { FieldType, type DataFrame } from '@grafana/data';

import { labelledToLong } from './labelledToLong';

const field = (name: string, values: unknown[], labels?: Record<string, string>) => ({
  name,
  type: name === 'time' ? FieldType.time : FieldType.number,
  config: labels ? { displayNameFromDS: `${name} ${Object.values(labels).join(' ')}` } : {},
  values,
  ...(labels ? { labels } : {}),
});

describe('labelledToLong', () => {
  it('turns a wide frame of tagged series into a row per series and instant', () => {
    // What Grafana Live makes of `bus,id=… latitude=…,longitude=…` pushed for two buses, one second apart.
    const wide: DataFrame = {
      refId: 'A',
      length: 2,
      fields: [
        field('time', [1000, 2000]),
        field('latitude', [-0.18, -0.181], { id: 'b00' }),
        field('longitude', [-78.48, -78.481], { id: 'b00' }),
        field('latitude', [null, -0.2], { id: 'b01' }),
        field('longitude', [null, -78.5], { id: 'b01' }),
      ],
    };
    const long = labelledToLong(wide) as DataFrame;
    expect(long.refId).toBe('A');
    expect(long.fields.map((f) => f.name)).toEqual(['time', 'id', 'latitude', 'longitude']);
    expect(long.fields.map((f) => f.values)).toEqual([
      [1000, 2000, 2000],
      ['b00', 'b00', 'b01'],
      [-0.18, -0.181, -0.2],
      [-78.48, -78.481, -78.5],
    ]);
    expect(long.length).toBe(3);
    // The value columns lose the series' labels and display name, which named one series.
    expect(long.fields[2].labels).toBeUndefined();
    expect(long.fields[2].config.displayNameFromDS).toBeUndefined();
    expect(long.fields[1].type).toBe(FieldType.string);
  });

  it('leaves a frame alone when any value column has no labels', () => {
    const table: DataFrame = {
      length: 1,
      fields: [field('time', [1000]), field('latitude', [-0.18]), field('longitude', [-78.48], { id: 'b00' })],
    };
    expect(labelledToLong(table)).toBeNull();
  });

  it('leaves a frame with no time column alone', () => {
    expect(labelledToLong({ length: 1, fields: [field('latitude', [-0.18], { id: 'b00' })] })).toBeNull();
  });
});
