import { createDataFrame, FieldType } from '@grafana/data';

import {
  type CatalogEntry,
  catalogDataset,
  catalogRaster,
  catalogRefsOf,
  catalogSeriesRasters,
  entriesOf,
  holdsWithin,
  rememberCatalogForTests,
  scenesOfFrame,
  searchCatalog,
  searchDataset,
  searchOf,
  whereInstead,
  whyNotAddable,
  seriesCalendar,
  withCatalogHref,
  withSeries,
} from './catalogSource';
import type { SavedMapConfig } from '../data/mapConfig';
import { pickScene } from '../data/rasterDataset';
import { entryDate, entryWhen, scenesLabel } from './CatalogPanel';

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

describe('a collection of dated rasters in a catalog', () => {
  const year = (y: number): CatalogEntry => ({
    id: `cci-biomass-${y}`,
    title: `ESA CCI Biomass, ${y}`,
    kind: 'raster',
    collection: 'cci-biomass',
    collectionTitle: 'ESA CCI Biomass',
    href: 'https://dap.ceda.ac.uk/agb.tif',
    serverHref: `http://feeds/cci-biomass/data/agb-${y}.vrt`,
    painted: true,
    start: Date.UTC(y, 0, 1),
    end: Date.UTC(y, 11, 31, 23, 59, 59),
    license: 'ESA CCI',
    thumbnail: null,
    bbox: [-180, -90, 180, 90],
  });
  const [tileset] = entriesOf(frame);
  const entries = [tileset, year(2010), year(2005), year(2020)];
  const context = {
    tileServerUrls: ['/titiler'],
    rasterMetadata: (raster: { sourceUrl: string }) => ({ sourceUrl: raster.sourceUrl, serverUrl: '/titiler' }),
  };

  it('is one series in the list, oldest scene first, named after its collection', () => {
    const listed = withSeries(entries);
    expect(listed.map((e) => e.id)).toEqual(['amsterdam-dam-lidar', 'cci-biomass']);
    const series = listed[1];
    expect(series).toMatchObject({ title: 'ESA CCI Biomass', kind: 'raster', start: Date.UTC(2005, 0, 1) });
    expect(series.scenes?.map((s) => s.entry)).toEqual(['cci-biomass-2005', 'cci-biomass-2010', 'cci-biomass-2020']);
    expect(entryWhen(series)).toBe('2005–2020 · 3 scenes');
    // One dated raster is no series.
    expect(withSeries([year(2020)])[0].scenes).toBeUndefined();
  });

  it('is saved with its scenes, drawn at the newest, and the time window picks a year by its span', () => {
    const series = withSeries(entries)[1];
    const saved = catalogDataset(series, 'cat', context)!;
    expect(saved.data).toMatchObject({
      id: 'catalog-cci-biomass',
      type: 'cogPainted',
      label: 'ESA CCI Biomass',
      metadata: {
        sourceUrl: 'http://feeds/cci-biomass/data/agb-2020.vrt',
        catalogSeries: 'cci-biomass',
        catalogUid: 'cat',
      },
    });
    expect(catalogRefsOf({ version: 'v1', config: {}, datasets: [saved] })).toEqual([
      { uid: 'cat', entry: 'cci-biomass' },
    ]);
    const [raster] = catalogSeriesRasters({ [saved.data.id]: saved.data });
    expect(raster).toMatchObject({ id: 'catalog-cci-biomass', kind: 'painted', tileServerUrls: ['/titiler'] });
    expect(raster.keepMetadata).toMatchObject({ catalogSeries: 'cci-biomass', catalogUid: 'cat' });
    // July 2010 is the 2010 map; a window over no year draws nothing.
    const july = { from: Date.UTC(2010, 6, 1), to: Date.UTC(2010, 6, 31) };
    expect(pickScene(raster.scenes, july)?.sourceUrl).toBe('http://feeds/cci-biomass/data/agb-2010.vrt');
    expect(pickScene(raster.scenes, { from: Date.UTC(2014, 0, 1), to: Date.UTC(2015, 0, 1) })).toBeNull();
    expect(seriesCalendar(raster)).toEqual([
      Date.UTC(2005, 0, 1),
      Date.UTC(2010, 0, 1),
      Date.UTC(2020, 0, 1),
      Date.UTC(2020, 11, 31, 23, 59, 59),
    ]);
  });

  it('keeps its years, each of which can be added alone, fixed', () => {
    const series = withSeries(entries)[1];
    expect(series.members?.map((e) => e.id)).toEqual(['cci-biomass-2005', 'cci-biomass-2010', 'cci-biomass-2020']);
    expect(scenesLabel(series.members ?? [])).toBe('Years');
    const alone = catalogDataset(series.members![1], 'cat', context)!;
    expect(alone.data).toMatchObject({
      id: 'catalog-cci-biomass-2010',
      metadata: { catalogEntry: 'cci-biomass-2010' },
    });
    expect(alone.data.metadata?.catalogScenes).toBeUndefined();
  });

  it('is found by its own name with every year, or by a year with that year only, shown open', () => {
    const listed = withSeries(entries);
    expect(searchCatalog(listed, 'biomass', '')[0].members).toHaveLength(3);
    expect(searchCatalog(listed, 'biomass', '')[0].foundByMembers).toBeUndefined();
    const found = searchCatalog(listed, '2010', '');
    expect(found.map((e) => e.id)).toEqual(['cci-biomass']);
    expect(found[0]).toMatchObject({ foundByMembers: true });
    expect(found[0].members?.map((e) => e.id)).toEqual(['cci-biomass-2010']);
    // Still the whole series to add.
    expect(found[0].scenes).toHaveLength(3);
  });

  it('keeps to the dashboard time range when asked: the years it touches, and what has no date', () => {
    const listed = withSeries(entries);
    const range = { from: Date.UTC(2010, 5, 1), to: Date.UTC(2011, 0, 1) };
    expect(holdsWithin(year(2010), range)).toBe(true);
    expect(holdsWithin(year(2020), range)).toBe(false);
    expect(holdsWithin(tileset, range)).toBe(true);
    const found = searchCatalog(listed, '', '', range);
    expect(found.map((e) => e.id)).toEqual(['amsterdam-dam-lidar', 'cci-biomass']);
    expect(found[1].members?.map((e) => e.id)).toEqual(['cci-biomass-2010']);
    expect(searchCatalog(listed, '', 'raster', { from: Date.UTC(2014, 0, 1), to: Date.UTC(2015, 0, 1) })).toEqual([]);
  });

  it('takes its scenes from the catalog again on load: a new year shows by itself', () => {
    const saved = catalogDataset(withSeries(entries)[1], 'cat', context)!;
    rememberCatalogForTests('cat', [...entries, year(2022)]);
    const restored = withCatalogHref(saved).data.metadata!;
    expect(restored.sourceUrl).toBe('http://feeds/cci-biomass/data/agb-2022.vrt');
    expect((restored.catalogScenes as Array<{ url: string }>).map((s) => s.url.slice(-8))).toEqual([
      '2005.vrt',
      '2010.vrt',
      '2020.vrt',
      '2022.vrt',
    ]);
    rememberCatalogForTests('cat', entries);
    expect(withCatalogHref(saved)).toBe(saved);
  });
});

describe('how the data source says a collection is a series', () => {
  const base = {
    title: 't',
    collectionTitle: 'C',
    href: 'https://x/y.tif',
    serverHref: null,
    painted: null,
    end: null,
    license: '',
    thumbnail: null,
    bbox: null,
  };
  const raster = (id: string, collection: string, start: number | null, series: 'items' | 'search' | null) =>
    ({ ...base, id, kind: 'raster', collection, start, series }) as CatalogEntry;
  const api = {
    ...base,
    id: 's2',
    title: 'Sentinel-2',
    kind: 'external',
    collection: 's2',
    href: 'https://stac.example.org/v1/collections/s2',
    start: 1,
    series: 'search',
  } as CatalogEntry;
  const catalog = { ...api, id: 'overture', series: null, href: 'https://x/catalog.json' } as CatalogEntry;
  const context = {
    tileServerUrls: ['/titiler'],
    rasterMetadata: (r: { sourceUrl: string; metadataUrl: string }) => ({ metadataUrl: r.metadataUrl }),
  };

  it('lists items series, searches API collections and listed tiles, leaves the rest', () => {
    const listed = withSeries([
      raster('y1', 'yearly', 1, 'items'),
      raster('y2', 'yearly', 2, 'items'),
      raster('t1', 'tiles', 1, 'search'),
      raster('t2', 'tiles', 1, 'search'),
      raster('one', 'single', 1, null),
      api,
      catalog,
    ]);
    expect(listed.map((e) => [e.id, e.scenes ? 'series' : e.search ? `search ${e.search.target}` : 'entry'])).toEqual([
      ['yearly', 'series'],
      ['tiles', 'search tiles'],
      ['one', 'entry'],
      ['s2', 'search s2'],
      ['overture', 'entry'],
    ]);
    expect(whyNotAddable(listed[3], context)).toBeNull();
    expect(whyNotAddable(listed[3])).toMatch(/tile server/);
    expect(whyNotAddable(listed[4], context)).toMatch(/query/);
  });

  it('saves a searched series as its search, never its scenes, drawn at the newest scene found', () => {
    const [entry] = withSeries([api]);
    const found = {
      scenes: [
        { time: 1, end: null, url: 'https://cogs/a.tif', item: 'https://stac/items/a' },
        { time: 2, end: null, url: 'https://cogs/b.tif', item: 'https://stac/items/b' },
      ],
      painted: null,
      truncated: false,
    };
    const saved = searchDataset(entry, 'cat', context, found, [-79.123456, -3.05, -78.9, -2.85])!;
    expect(saved.data).toMatchObject({
      id: 'catalog-s2',
      type: 'raster-tile',
      metadata: {
        metadataUrl: '/titiler/cog/stac?url=https%3A%2F%2Fcogs%2Fb.tif',
        catalogSearch: { target: 's2', bbox: [-79.12346, -3.05, -78.9, -2.85] },
        catalogUid: 'cat',
      },
    });
    expect(saved.data.metadata?.catalogScenes).toBeUndefined();
    expect(searchOf(saved.data.metadata)).toEqual({ target: 's2', bbox: [-79.12346, -3.05, -78.9, -2.85] });
    expect(searchDataset(entry, 'cat', context, { ...found, scenes: [] }, [0, 0, 1, 1])).toBeNull();
    // Moved by the map's clock from two scenes up, with the items for band combinations.
    const [moving] = catalogSeriesRasters({ 'catalog-s2': saved.data }, new Map([['catalog-s2', found]]));
    expect(moving.scenes.map((scene) => [scene.time, scene.itemUrl])).toEqual([
      [1, 'https://stac/items/a'],
      [2, 'https://stac/items/b'],
    ]);
    expect(moving.keepMetadata).toEqual({ catalogSearch: saved.data.metadata?.catalogSearch, catalogUid: 'cat' });
    expect(catalogSeriesRasters({ 'catalog-s2': saved.data })).toEqual([]);
  });

  it('reads a search frame: scenes oldest first, the items, whether a limit cut it', () => {
    const searchFrame = createDataFrame({
      fields: [
        { name: 'time', type: FieldType.time, values: [20, 10] },
        { name: 'raster_url', type: FieldType.string, values: ['b.tif', 'a.tif'] },
        { name: 'raster_item_url', type: FieldType.string, values: ['ib', 'ia'] },
      ],
    });
    searchFrame.meta = { notices: [{ severity: 'warning', text: 'cut' }] };
    expect(scenesOfFrame(searchFrame)).toEqual({
      scenes: [
        { time: 10, end: null, url: 'a.tif', item: 'ia' },
        { time: 20, end: null, url: 'b.tif', item: 'ib' },
      ],
      painted: null,
      truncated: true,
    });
  });
});
