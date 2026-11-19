import { createDataFrame, FieldType } from '@grafana/data';

import {
  type CatalogEntry,
  entriesOf,
  featuresDataset,
  featuresOf,
  featuresOfSource,
  featuresUrl,
  MAX_BROWSER_FILE,
  parquetLayer,
  readsByArea,
  withSeries,
  vectorDataset,
  vectorFormat,
  vectorQuery,
  whyNotAddable,
  whereInstead,
} from './catalogSource';

const entry = (patch: Partial<CatalogEntry>): CatalogEntry => ({
  id: 'e',
  title: 'E',
  kind: 'vector',
  collection: 'c',
  collectionTitle: 'C',
  href: 'https://data.example.org/castles.geojson',
  serverHref: null,
  painted: null,
  start: null,
  end: null,
  license: '',
  thumbnail: null,
  bbox: null,
  ...patch,
});

describe('a vector file from a catalog', () => {
  it('is read as kepler reads it, by name or media type; a large one or one it cannot read, by query', () => {
    expect(vectorFormat(entry({}))).toBe('geojson');
    expect(vectorFormat(entry({ href: 'https://d.org/a', mediaType: 'text/csv' }))).toBe('csv');
    expect(vectorFormat(entry({ href: 'https://d.org/a.fgb' }))).toBe('fgb');
    expect(vectorFormat(entry({ href: 'https://d.org/a.gpkg' }))).toBeNull();
    expect(whyNotAddable(entry({}))).toBeNull();
    expect(whyNotAddable(entry({ size: MAX_BROWSER_FILE + 1 }))).toMatch(/too large.*by query/);
    expect(whyNotAddable(entry({ href: 'https://d.org/a.gpkg' }))).toMatch(/by query/);
    expect(whereInstead(entry({ href: 'https://d.org/a.gpkg' }))).toBe('By query');
    expect(vectorQuery(entry({ href: '/datasets/c.parquet', serverHref: 'http://feeds/datasets/c.parquet' }))).toBe(
      "SELECT * FROM read_parquet('http://feeds/datasets/c.parquet')"
    );
    expect(vectorQuery(entry({ href: 'https://d.org/a.gpkg' }))).toBe("SELECT * FROM ST_Read('https://d.org/a.gpkg')");
  });

  it('is saved as a file kepler loads by its address', async () => {
    const saved = (await vectorDataset(entry({ id: 'c:castles' }), 'cat'))!;
    expect(saved.data).toMatchObject({
      id: 'catalog-c-castles',
      type: 'externally-hosted',
      metadata: { source: 'https://data.example.org/castles.geojson', format: 'geojson', catalogEntry: 'c:castles' },
    });
  });

  it('reads size, items address and media type from a catalog search', () => {
    const frame = createDataFrame({
      fields: [
        { name: 'id', type: FieldType.string, values: ['f'] },
        { name: 'kind', type: FieldType.string, values: ['features'] },
        { name: 'href', type: FieldType.string, values: ['https://f.org/collections/f'] },
        { name: 'size', type: FieldType.number, values: [1234] },
        { name: 'items_href', type: FieldType.string, values: ['https://f.org/collections/f/items?f=json'] },
        { name: 'media_type', type: FieldType.string, values: ['application/json'] },
      ],
    });
    expect(entriesOf(frame)[0]).toMatchObject({
      size: 1234,
      itemsHref: 'https://f.org/collections/f/items?f=json',
      mediaType: 'application/json',
    });
  });
});

describe('features of an OGC API from a catalog', () => {
  const features = entry({
    id: 'castles',
    kind: 'features',
    itemsHref: 'https://f.org/collections/castles/items?f=json',
  });

  it('are loaded by kepler from the items of the view, and asked again as it moves', () => {
    expect(whyNotAddable(features)).toBeNull();
    const saved = featuresDataset(features, 'cat', [4, 52, 5, 53], { from: 0, to: 1000 })!;
    const source = new URL(saved.data.metadata?.source as string);
    expect(source.searchParams.get('f')).toBe('json');
    expect(source.searchParams.get('bbox')).toBe('4,52,5,53');
    // No temporal extent: no time asked.
    expect(source.searchParams.has('datetime')).toBe(false);
    expect(saved.data).toMatchObject({ type: 'externally-hosted', metadata: { format: 'geojson', catalogUid: 'cat' } });
    expect(featuresOf(saved.data.metadata)).toMatchObject({ followView: true, time: false, bbox: [4, 52, 5, 53] });
    const dated = featuresDataset({ ...features, start: 0 }, 'cat', [4, 52, 5, 53], { from: 0, to: 1000 })!;
    expect(new URL(dated.data.metadata?.source as string).searchParams.get('datetime')).toBe(
      '1970-01-01T00:00:00.000Z/1970-01-01T00:00:01.000Z'
    );
    expect(featuresUrl({ protocol: 'ogc-features', itemsHref: 'https://f.org/i' }, null, null, 10)).toBe(
      'https://f.org/i?limit=10'
    );
    // Kepler keeps only a file dataset's address: the search is read back off it.
    expect(featuresOfSource(saved.data.id, saved.data.metadata?.source)).toEqual({
      protocol: 'ogc-features',
      itemsHref: 'https://f.org/collections/castles/items?f=json',
      timeProperty: null,
      bbox: [4, 52, 5, 53],
      followView: true,
      time: false,
      limit: 2000,
    });
    expect(featuresOfSource(dated.data.id, dated.data.metadata?.source)?.time).toBe(true);
    expect(featuresOfSource('mine', saved.data.metadata?.source)).toBeNull();
    expect(featuresOfSource('catalog-file', 'https://d.org/castles.geojson')).toBeNull();
    expect(whyNotAddable({ ...features, itemsHref: null })).toMatch(/no GeoJSON/);
  });
});

describe('a GeoParquet from a catalog', () => {
  const part = (i: number) =>
    entry({
      id: `0000${i}`,
      collection: 'place',
      href: `https://s3.example.org/part-0000${i}.zstd.parquet`,
      size: 7e8,
      mediaType: 'application/vnd.apache.parquet',
    });
  const collection = entry({
    id: 'place',
    kind: 'geoparquet',
    collection: 'place',
    title: 'Places',
    href: 'https://stac.example.org/place',
    size: 1.2e10,
  });

  it('is read by area whatever its size, a collection of files as one, its files not listed apart', () => {
    expect(readsByArea(collection)).toBe(true);
    expect(readsByArea(part(1))).toBe(true);
    expect(whyNotAddable(part(1))).toBeNull();
    expect(whyNotAddable(collection)).toBeNull();
    expect(withSeries([collection, part(1), part(2)]).map((e) => e.id)).toEqual(['place']);
    expect(withSeries([part(1)]).map((e) => e.id)).toEqual(['00001']);
  });

  it('is added as a layer the map asks for over its view: the collection, or the one file', () => {
    expect(parquetLayer(collection, 'cat', [4.8, 52.3, 5, 52.4])).toEqual({
      id: 'catalog-place',
      label: 'Places',
      uid: 'cat',
      target: 'place',
      columns: [],
      bbox: [4.8, 52.3, 5, 52.4],
      followView: true,
    });
    expect(parquetLayer(part(1), 'cat', [0, 0, 1, 1]).target).toBe('00001');
  });
});
