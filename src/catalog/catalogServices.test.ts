import { createDataFrame, FieldType } from '@grafana/data';

import {
  type CatalogEntry,
  type CatalogService,
  entriesOf,
  pmtilesKind,
  serviceDataset,
  serviceTemplate,
  whyNotAddable,
} from './catalogSource';

const service = (patch: Partial<CatalogService>): CatalogService => ({
  protocol: 'wms',
  layers: [],
  styles: [],
  transparent: null,
  dimensions: {},
  encoding: null,
  uriTemplate: null,
  variables: {},
  servers: [],
  mediaType: '',
  ...patch,
});
const entry = (id: string, href: string, s: CatalogService): CatalogEntry => ({
  id,
  title: `Title of ${id}`,
  kind: 'map-service',
  collection: 'c',
  collectionTitle: 'C',
  href,
  serverHref: null,
  painted: null,
  start: null,
  end: null,
  license: 'CC-BY-4.0',
  thumbnail: null,
  bbox: null,
  service: s,
});

describe('a map service from a catalog', () => {
  it('reads the service column of a catalog search', () => {
    const frame = createDataFrame({
      fields: [
        { name: 'id', type: FieldType.string, values: ['c:wms:ir'] },
        { name: 'kind', type: FieldType.string, values: ['map-service'] },
        { name: 'href', type: FieldType.string, values: ['https://maps.example.org/wms'] },
        { name: 'service', type: FieldType.string, values: [JSON.stringify(service({ layers: ['ir'] }))] },
      ],
    });
    expect(entriesOf(frame)[0].service).toMatchObject({ protocol: 'wms', layers: ['ir'] });
  });

  it("turns a WMTS's REST template into tiles, its variables at their defaults; not a KVP one", async () => {
    const rest = service({
      protocol: 'wmts',
      encoding: 'rest',
      layers: ['tc'],
      uriTemplate: 'https://m.example.org/tc/default/{Time}/GoogleMapsCompatible/{TileMatrix}/{TileRow}/{TileCol}.jpg',
      variables: { Time: { type: 'string', default: 'default' } },
    });
    expect(serviceTemplate(rest)).toBe('https://m.example.org/tc/default/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg');
    // Its last level, when the catalog says: enlarged past it rather than asked for.
    const capped = await serviceDataset(entry('w', 'https://m.example.org/caps.xml', { ...rest, maxZoom: 9 }), 'cat');
    expect(capped?.data.metadata).toMatchObject({ maxZoom: 9 });
    expect(capped?.data.metadata).not.toHaveProperty('minZoom');
    expect(serviceTemplate({ ...rest, variables: {} })).toBeNull();
    expect(serviceTemplate({ ...rest, variables: {}, dimensions: { Time: '2024-01-01' } })).toContain('/2024-01-01/');
    const kvp = service({ protocol: 'wmts', encoding: 'kvp', layers: ['tc'] });
    expect(whyNotAddable(entry('k', 'https://m.example.org/wmts', kvp))).toMatch(/without its template/);
    // A WMTS whose levels have names of their own (PDOK's 00, 01…): the tiles carry them.
    const named = await serviceDataset(
      entry('p', 'https://p.example.org/wmts', {
        ...rest,
        uriTemplate: 'https://p/{TileMatrix}/{TileCol}/{TileRow}.png',
        variables: {},
        zoomIds: { '0': '00', '1': '01' },
      }),
      'cat'
    );
    expect(named?.data.metadata).toMatchObject({ url: 'https://p/{z}/{x}/{y}.png', zoomIds: { '0': '00', '1': '01' } });
    expect(
      serviceTemplate(service({ protocol: 'xyz', servers: ['a', 'b'] }), 'https://{s}.t.org/{z}/{x}/{y}.png')
    ).toBe('https://a.t.org/{z}/{x}/{y}.png');
  });

  it('is saved as the map draws it: a WMS with its layer, a template as tiles, no tile server needed', async () => {
    const wms = (await serviceDataset(
      entry('c:wms:ir,coast', 'https://maps.example.org/wms?x=1', service({ layers: ['ir', 'coast'] })),
      'cat'
    ))!;
    expect(wms.data).toMatchObject({
      id: 'catalog-c-wms-ir-coast',
      type: 'wms-tile',
      label: 'Title of c:wms:ir,coast',
      metadata: {
        remoteTileFormat: 'wms',
        tilesetDataUrl: 'https://maps.example.org/wms',
        catalogWmsLayer: 'ir,coast',
        catalogEntry: 'c:wms:ir,coast',
        catalogUid: 'cat',
      },
    });
    expect(whyNotAddable(entry('x', 'u', service({})))).toBeNull();
    const xyz = (await serviceDataset(
      entry('c:xyz:0', 'https://t.org/{z}/{x}/{y}.png', service({ protocol: 'xyz' })),
      'cat'
    ))!;
    expect(xyz.data).toMatchObject({
      type: 'xyz-tiles',
      metadata: { url: 'https://t.org/{z}/{x}/{y}.png', catalogUid: 'cat' },
    });
  });

  it('reads a TileJSON to tell vector tiles from a raster template, and a PMTiles header for its kind', async () => {
    const real = global.fetch;
    const answers: Record<string, unknown> = {
      'https://t.org/vector': { tiles: ['https://t.org/v/{z}/{x}/{y}.pbf'], vector_layers: [{ id: 'roads' }] },
      'https://t.org/raster': { tiles: ['https://t.org/r/{z}/{x}/{y}.png'], minzoom: 2, maxzoom: 9 },
    };
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => answers[url],
    })) as unknown as typeof fetch;
    try {
      const vector = (await serviceDataset(
        entry('v', 'https://t.org/vector', service({ protocol: 'tilejson' })),
        'cat'
      ))!;
      expect(vector.data).toMatchObject({
        type: 'vector-tile',
        metadata: {
          remoteTileFormat: 'mvt',
          tilesetDataUrl: 'https://t.org/v/{z}/{x}/{y}.pbf',
          tilesetMetadataUrl: 'https://t.org/vector',
        },
      });
      const raster = (await serviceDataset(
        entry('r', 'https://t.org/raster', service({ protocol: 'tilejson' })),
        'cat'
      ))!;
      expect(raster.data).toMatchObject({
        type: 'xyz-tiles',
        metadata: { url: 'https://t.org/r/{z}/{x}/{y}.png', minZoom: 2, maxZoom: 9 },
      });
    } finally {
      global.fetch = real;
    }
    const named = (await serviceDataset(
      entry('p', 'https://d.org/roads.pmtiles', service({ protocol: 'pmtiles', layers: ['roads'] })),
      'cat'
    ))!;
    expect(named.data).toMatchObject({ type: 'vector-tile', metadata: { remoteTileFormat: 'pmtiles' } });
    const header = (type: number) => {
      const bytes = new Uint8Array(127);
      bytes.set(
        [...'PMTiles'].map((c) => c.charCodeAt(0)),
        0
      );
      bytes[99] = type;
      return (async () => ({ arrayBuffer: async () => bytes.buffer })) as unknown as typeof fetch;
    };
    expect(await pmtilesKind('u', header(1))).toBe('vector');
    expect(await pmtilesKind('u', header(2))).toBe('raster');
    expect(await pmtilesKind('u', header(0))).toBeNull();
  });
});
