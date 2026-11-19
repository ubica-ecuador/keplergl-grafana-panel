import { createDataFrame, FieldType } from '@grafana/data';

import { keepRemoteDatasets } from '../data/mapConfig';
import { cubeLabel, entriesOf, whyNotAddable, zarrDataset } from './catalogSource';

const cube = {
  storeUrl: 'icechunk+https://b.s3.amazonaws.com/noaa-gfs-forecast/v0.2.7.icechunk',
  variable: 'temperature_2m',
  dimension: 'init_time',
  selectors: ['lead_time=0'],
  unit: 'degree_Celsius',
};
const frame = createDataFrame({
  fields: [
    { name: 'id', type: FieldType.string, values: ['noaa-gfs-forecast:temperature_2m'] },
    { name: 'title', type: FieldType.string, values: ['2 metre temperature (degree_Celsius)'] },
    { name: 'kind', type: FieldType.string, values: ['zarr'] },
    { name: 'collection', type: FieldType.string, values: ['noaa-gfs-forecast'] },
    { name: 'collection_title', type: FieldType.string, values: ['NOAA GFS forecast'] },
    { name: 'href', type: FieldType.string, values: [cube.storeUrl] },
    { name: 'cube', type: FieldType.string, values: [JSON.stringify(cube)] },
  ],
});

describe('a data cube variable from a catalog', () => {
  const [entry] = entriesOf(frame);

  it('is read with its store and axes, and drawn only with a tile server', () => {
    expect(entry.cube).toEqual(cube);
    expect(cubeLabel(entry)).toEqual(['Zarr', 'temperature_2m', 'NOAA GFS forecast']);
    expect(whyNotAddable(entry, { tileServerUrls: [] })).toMatch(/no tile server/);
    expect(whyNotAddable(entry, { tileServerUrls: ['https://t.org/titiler'] })).toBeNull();
    expect(whyNotAddable({ ...entry, cube: undefined }, { tileServerUrls: ['https://t.org/titiler'] })).toMatch(
      /datacube/
    );
  });

  it("is the panel's Zarr layer, saved with the map, its moments asked of the catalog", () => {
    const saved = zarrDataset(entry, 'dyn', { tileServerUrls: ['https://t.org/titiler'] })!;
    expect(saved.data).toMatchObject({
      id: 'catalog-noaa-gfs-forecast-temperature_2m',
      type: 'zarrTiles',
      metadata: {
        serverUrl: 'https://t.org/titiler',
        storeUrl: cube.storeUrl,
        variable: 'temperature_2m',
        selectors: ['lead_time=0'],
        dimension: 'init_time',
        catalogZarr: 'noaa-gfs-forecast:temperature_2m',
        catalogUid: 'dyn',
      },
    });
    expect(keepRemoteDatasets([saved])).toHaveLength(1);
  });
});
