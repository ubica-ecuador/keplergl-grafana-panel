import { createDataFrame, FieldType } from '@grafana/data';

import {
  catalogDataset,
  catalogRefsOf,
  entriesOf,
  rememberCatalogForTests,
  searchCatalog,
  whyNotAddable,
  withCatalogHref,
} from './catalogSource';
import type { SavedMapConfig } from '../data/mapConfig';

// A Catalog search frame as the Ubica Catalog data source answers it.
const frame = createDataFrame({
  fields: [
    { name: 'title', type: FieldType.string, values: ['Dam Square point cloud', 'Madrid complex', 'Sentinel-2 L2A'] },
    { name: 'kind', type: FieldType.string, values: ['3d-tiles', 'gltf-model', 'external'] },
    { name: 'collection', type: FieldType.string, values: ['amsterdam-dam-lidar', 'dsn-antennas', 'sentinel-2-l2a'] },
    { name: 'id', type: FieldType.string, values: ['amsterdam-dam-lidar', 'dsn-madrid', 'sentinel-2-l2a'] },
    {
      name: 'href',
      type: FieldType.string,
      values: [
        'https://pacha.example.org/datasets/amsterdam-panoramas/lidar/tileset.json',
        'https://pacha.example.org/datasets/dsn-antennas/mdscc.glb',
        'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a',
      ],
    },
    { name: 'license', type: FieldType.string, values: ['AHN5, CC0', 'NASA', 'Copernicus'] },
    {
      name: 'thumbnail',
      type: FieldType.string,
      values: ['/api/datasources/proxy/uid/cat/catalog/a/thumbnail.jpg', null, null],
    },
    { name: 'xmin', type: FieldType.number, values: [4.889233, -4.25, -180] },
    { name: 'ymin', type: FieldType.number, values: [52.37109, 40.43, -90] },
    { name: 'xmax', type: FieldType.number, values: [4.895886, -4.25, 180] },
    { name: 'ymax', type: FieldType.number, values: [52.375162, 40.43, 90] },
  ],
});

describe('a catalog read through its data source', () => {
  const entries = entriesOf(frame);

  it('reads every row of a search frame as an entry', () => {
    expect(entries.map((e) => [e.id, e.kind])).toEqual([
      ['amsterdam-dam-lidar', '3d-tiles'],
      ['dsn-madrid', 'gltf-model'],
      ['sentinel-2-l2a', 'external'],
    ]);
    expect(entries[0]).toMatchObject({
      title: 'Dam Square point cloud',
      bbox: [4.889233, 52.37109, 4.895886, 52.375162],
      thumbnail: '/api/datasources/proxy/uid/cat/catalog/a/thumbnail.jpg',
    });
    expect(entries[1].thumbnail).toBeNull();
  });

  it('finds entries by every word and by kind, and says why one cannot join a free map', () => {
    expect(searchCatalog(entries, 'dam point', '').map((e) => e.id)).toEqual(['amsterdam-dam-lidar']);
    expect(searchCatalog(entries, '', 'gltf-model').map((e) => e.id)).toEqual(['dsn-madrid']);
    expect(whyNotAddable(entries[0])).toBeNull();
    expect(whyNotAddable(entries[1])).toMatch(/Kepler Plus/);
    expect(whyNotAddable(entries[2])).toMatch(/query/);
  });
});

describe('a tileset added from a catalog', () => {
  const [tileset, model] = entriesOf(frame);

  it('is saved as kepler saves a tileset, with where it came from', () => {
    expect(catalogDataset(model, 'cat')).toBeNull();
    const saved = catalogDataset(tileset, 'cat')!;
    expect(saved.data).toMatchObject({
      id: 'catalog-amsterdam-dam-lidar',
      type: 'tile-3d',
      label: 'Dam Square point cloud',
      metadata: { tile3dUrl: tileset.href, catalogEntry: 'amsterdam-dam-lidar', catalogUid: 'cat' },
    });
    const config: SavedMapConfig = { version: 'v1', config: {}, datasets: [saved] };
    expect(catalogRefsOf(config)).toEqual([{ uid: 'cat', entry: 'amsterdam-dam-lidar' }]);
  });

  it('takes its address from the catalog again on load, and keeps the saved one when the catalog has not answered', () => {
    const saved = catalogDataset({ ...tileset, href: 'https://old.example.org/lidar/tileset.json' }, 'cat')!;
    expect(withCatalogHref(saved)).toBe(saved);
    rememberCatalogForTests('cat', { 'amsterdam-dam-lidar': tileset.href });
    expect(withCatalogHref(saved).data.metadata?.tile3dUrl).toBe(tileset.href);
    expect(withCatalogHref({ ...saved, data: { ...saved.data, metadata: { tile3dUrl: 'x' } } }).data.metadata).toEqual({
      tile3dUrl: 'x',
    });
  });
});
