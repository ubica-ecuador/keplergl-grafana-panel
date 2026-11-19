import { createDataFrame, FieldType } from '@grafana/data';

import {
  catalogDataset,
  catalogRaster,
  catalogRefsOf,
  entriesOf,
  rememberCatalogForTests,
  searchCatalog,
  whereInstead,
  whyNotAddable,
  withCatalogHref,
} from './catalogSource';
import type { SavedMapConfig } from '../data/mapConfig';
import { entryDate } from './CatalogPanel';

// A Catalog search frame as the Ubica Catalog data source answers it.
const frame = createDataFrame({
  fields: [
    {
      name: 'title',
      type: FieldType.string,
      values: ['Dam Square point cloud', 'Madrid complex', 'Sentinel-2 L2A', 'Biomass, 2020', 'Land cover'],
    },
    { name: 'kind', type: FieldType.string, values: ['3d-tiles', 'gltf-model', 'external', 'raster', 'raster'] },
    {
      name: 'collection',
      type: FieldType.string,
      values: ['amsterdam-dam-lidar', 'dsn-antennas', 'sentinel-2-l2a', 'cci-biomass', 'land-cover'],
    },
    {
      name: 'id',
      type: FieldType.string,
      values: ['amsterdam-dam-lidar', 'dsn-madrid', 'sentinel-2-l2a', 'cci-biomass-2020', 'land-cover'],
    },
    {
      name: 'href',
      type: FieldType.string,
      values: [
        'https://pacha.example.org/datasets/amsterdam-panoramas/lidar/tileset.json',
        'https://pacha.example.org/datasets/dsn-antennas/mdscc.glb',
        'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a',
        'https://dap.ceda.ac.uk/agb.tif',
        'https://example.org/land-cover.tif',
      ],
    },
    {
      name: 'server_href',
      type: FieldType.string,
      values: [null, null, null, 'http://feeds/cci-biomass/data/agb-2020.vrt', null],
    },
    { name: 'painted', type: FieldType.boolean, values: [null, null, null, true, null] },
    { name: 'start', type: FieldType.time, values: [null, null, null, Date.UTC(2020, 0, 1), null] },
    { name: 'license', type: FieldType.string, values: ['AHN5, CC0', 'NASA', 'Copernicus', 'ESA CCI', 'CC-BY-4.0'] },
    {
      name: 'thumbnail',
      type: FieldType.string,
      values: ['/api/datasources/proxy/uid/cat/catalog/a/thumbnail.jpg', null, null, null, null],
    },
    { name: 'xmin', type: FieldType.number, values: [4.889233, -4.25, -180, -180, -180] },
    { name: 'ymin', type: FieldType.number, values: [52.37109, 40.43, -90, -90, -90] },
    { name: 'xmax', type: FieldType.number, values: [4.895886, -4.25, 180, 180, 180] },
    { name: 'ymax', type: FieldType.number, values: [52.375162, 40.43, 90, 90, 90] },
  ],
});

describe('a catalog read through its data source', () => {
  const entries = entriesOf(frame);

  it('reads every row of a search frame as an entry', () => {
    expect(entries.map((e) => [e.id, e.kind])).toEqual([
      ['amsterdam-dam-lidar', '3d-tiles'],
      ['dsn-madrid', 'gltf-model'],
      ['sentinel-2-l2a', 'external'],
      ['cci-biomass-2020', 'raster'],
      ['land-cover', 'raster'],
    ]);
    expect(entries[0]).toMatchObject({
      title: 'Dam Square point cloud',
      bbox: [4.889233, 52.37109, 4.895886, 52.375162],
      thumbnail: '/api/datasources/proxy/uid/cat/catalog/a/thumbnail.jpg',
    });
    expect(entries[1].thumbnail).toBeNull();
    expect(entries[3]).toMatchObject({
      serverHref: 'http://feeds/cci-biomass/data/agb-2020.vrt',
      painted: true,
      start: Date.UTC(2020, 0, 1),
    });
    expect(entries[4]).toMatchObject({ serverHref: null, painted: null, start: null });
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

describe('a raster added from a catalog', () => {
  const [, , , biomass, landCover] = entriesOf(frame);
  const context = {
    tileServerUrls: ['/titiler'],
    // keplerAdapter's: here, only what the test can tell apart.
    rasterMetadata: (raster: { kind: string; sourceUrl: string; metadataUrl: string }) => ({
      kind: raster.kind,
      sourceUrl: raster.sourceUrl,
      metadataUrl: raster.metadataUrl,
    }),
  };

  it('shows its year in the picker, since a yearly series shares one title', () => {
    expect(entryDate(biomass.start)).toBe('2020');
    expect(entryDate(Date.UTC(2024, 6, 15))).toBe('2024-07-15');
    expect(entryDate(null)).toBe('');
  });

  it('needs a tile server, and reads the address the catalog gives tile servers', () => {
    expect(whyNotAddable(biomass)).toMatch(/tile server/);
    expect(whereInstead(biomass)).toBe('No tile server');
    expect(whyNotAddable(biomass, context)).toBeNull();
    expect(catalogRaster(biomass, ['/titiler'])).toEqual({
      kind: 'painted',
      sourceUrl: 'http://feeds/cci-biomass/data/agb-2020.vrt',
      metadataUrl: 'http://feeds/cci-biomass/data/agb-2020.vrt',
      tileServerUrls: ['/titiler'],
    });
    expect(catalogRaster(landCover, ['/titiler'])).toMatchObject({
      kind: 'cog',
      metadataUrl: '/titiler/cog/stac?url=https%3A%2F%2Fexample.org%2Fland-cover.tif',
    });
  });

  it('is saved as the panel draws a painted COG or a raster tileset, with where it came from', () => {
    expect(catalogDataset(biomass, 'cat')).toBeNull();
    expect(catalogDataset(biomass, 'cat', context)?.data).toMatchObject({
      id: 'catalog-cci-biomass-2020',
      type: 'cogPainted',
      metadata: {
        kind: 'painted',
        sourceUrl: 'http://feeds/cci-biomass/data/agb-2020.vrt',
        catalogEntry: 'cci-biomass-2020',
        catalogUid: 'cat',
      },
    });
    expect(catalogDataset(landCover, 'cat', context)?.data.type).toBe('raster-tile');
  });

  it('follows its entry on load: a painted one by its source, a tiled one by its metadata url', () => {
    const painted = catalogDataset(biomass, 'cat', context)!;
    rememberCatalogForTests('cat', { 'cci-biomass-2020': 'http://feeds/moved/agb-2020.vrt' });
    expect(withCatalogHref(painted).data.metadata?.sourceUrl).toBe('http://feeds/moved/agb-2020.vrt');
    const tiled = catalogDataset(landCover, 'cat', context)!;
    tiled.data.metadata = { ...tiled.data.metadata, rasterTileServerUrls: ['/titiler'] };
    rememberCatalogForTests('cat', { 'land-cover': 'https://example.org/moved.tif' });
    expect(withCatalogHref(tiled).data.metadata?.metadataUrl).toBe(
      '/titiler/cog/stac?url=https%3A%2F%2Fexample.org%2Fmoved.tif'
    );
  });
});
