import { FieldType } from '@grafana/data';

import { toKeplerDatasets } from './keplerAdapter';

describe('toKeplerDatasets', () => {
  it('hands kepler the typed columns of a query that returned no rows', () => {
    const [dataset] = toKeplerDatasets([
      {
        id: 'grafana-B',
        label: 'Query B',
        rows: [],
        columns: [
          { name: 'unidad', type: FieldType.string },
          { name: 'latitude', type: FieldType.number },
          { name: 'longitude', type: FieldType.number },
          { name: 'time', type: FieldType.time },
        ],
      },
    ]);

    expect(dataset.data.rows).toEqual([]);
    expect(dataset.data.fields.map((field) => field.name)).toEqual(['unidad', 'latitude', 'longitude', 'time']);

    // The same types the dataset gets once rows arrive, so a layer saved against
    // the empty dataset still validates when the refresh fills it in.
    const [filled] = toKeplerDatasets([
      {
        id: 'grafana-B',
        label: 'Query B',
        rows: [{ unidad: 'y1675', latitude: 42.3259, longitude: -71.0628, time: 1789402611000 }],
      },
    ]);
    expect(dataset.data.fields.map((field) => field.type)).toEqual(filled.data.fields.map((field) => field.type));
  });
});
