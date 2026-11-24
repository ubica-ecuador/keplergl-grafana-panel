import { createDataFrame, FieldType } from '@grafana/data';

import {
  byAreaLabel,
  catalogDataset,
  catalogRaster,
  entriesOf,
  loadableUrl,
  scenesOfFrame,
  seriesRaster,
  serviceDataset,
  tilesEntry,
} from './catalogSource';
import { COG_PAINTED_TYPE } from '../panel/cogPaintedLayer';

// What the Spatial Catalog data source gives for a Portolan catalog: a GeoParquet with its PMTiles (`tiles`), and a
// classified COG painted as its catalog says (`paint`).
const PAINT = 'bidx=1&colormap=%7B%221%22%3A%5B77%2C146%2C33%2C255%5D%7D&resampling=nearest&reproject=nearest';
const TILES = {
  href: 'https://data.example/fuentes/fuentes.pmtiles',
  mediaType: 'application/vnd.pmtiles',
  service: {
    protocol: 'pmtiles',
    layers: ['fuentes'],
    styles: [],
    transparent: null,
    dimensions: {},
    encoding: null,
    uriTemplate: null,
    variables: {},
    servers: [],
    mediaType: 'application/vnd.pmtiles',
  },
};
const frame = createDataFrame({
  fields: [
    { name: 'id', type: FieldType.string, values: ['fuentes', 'forest-cover'] },
    { name: 'title', type: FieldType.string, values: ['Fuentes de agua', 'Forest cover 2020'] },
    { name: 'kind', type: FieldType.string, values: ['vector', 'raster'] },
    { name: 'collection', type: FieldType.string, values: ['fuentes', 'forest-cover'] },
    {
      name: 'href',
      type: FieldType.string,
      values: ['https://data.example/fuentes/fuentes.parquet', 'https://data.example/jrc/forest.tif'],
    },
    {
      name: 'media_type',
      type: FieldType.string,
      values: ['application/vnd.apache.parquet', 'image/tiff; application=geotiff; profile=cloud-optimized'],
    },
    { name: 'painted', type: FieldType.boolean, values: [null, true] },
    { name: 'paint', type: FieldType.string, values: [null, PAINT] },
    { name: 'tiles', type: FieldType.string, values: [JSON.stringify(TILES), null] },
    { name: 'size', type: FieldType.number, values: [31343, 40491726377] },
  ],
});

describe('a Portolan catalog in Add from catalog', () => {
  it("reads a file's tiles and a raster's painting off the search", () => {
    const [fuentes, forest] = entriesOf(frame);
    expect(fuentes.tiles).toMatchObject({ href: TILES.href, service: { protocol: 'pmtiles', layers: ['fuentes'] } });
    expect(fuentes.paint).toBeUndefined();
    expect(forest).toMatchObject({ painted: true, paint: PAINT });
    expect(forest.tiles).toBeUndefined();
    // The row says there are tiles, beside the file read by area.
    expect(byAreaLabel(fuentes)).toContain('and tiles');
  });

  it("adds a file's tiles as the map service they are, under the file's title", async () => {
    const [fuentes, forest] = entriesOf(frame);
    expect(tilesEntry(forest)).toBeNull();
    const tiles = tilesEntry(fuentes)!;
    expect(tiles).toMatchObject({
      id: 'fuentes:tiles',
      kind: 'map-service',
      href: TILES.href,
      title: 'Fuentes de agua',
    });
    const saved = (await serviceDataset(tiles, 'cat'))!;
    expect(saved.data).toMatchObject({
      type: 'vector-tile',
      label: 'Fuentes de agua',
      metadata: {
        remoteTileFormat: 'pmtiles',
        tilesetDataUrl: TILES.href,
        // kepler reads an archive's metadata from here; without it the layer never asks for a tile.
        tilesetMetadataUrl: TILES.href,
        catalogEntry: 'fuentes:tiles',
        catalogUid: 'cat',
      },
    });
  });

  it('paints a classified raster with its parameters, through the tile server', () => {
    const [, forest] = entriesOf(frame);
    expect(catalogRaster(forest, ['https://tiler.example'])).toMatchObject({ kind: 'painted', paint: PAINT });
    const saved = catalogDataset(forest, 'cat', {
      tileServerUrls: ['https://tiler.example'],
      rasterMetadata: (raster) => ({
        serverUrl: raster.tileServerUrls[0],
        sourceUrl: raster.sourceUrl,
        paint: raster.paint,
      }),
    })!;
    expect(saved.data).toMatchObject({
      type: COG_PAINTED_TYPE,
      metadata: { paint: PAINT, catalogEntry: 'forest-cover' },
    });
    // A raster the catalog says nothing about takes no parameters.
    expect(catalogRaster({ ...forest, painted: null }, ['https://tiler.example']).paint).toBeUndefined();
  });

  it('keeps the painting of a series rebuilt from what kepler holds, and of searched scenes', () => {
    const raster = seriesRaster(
      'catalog-forest-cover',
      {
        type: COG_PAINTED_TYPE,
        metadata: { serverUrl: 'https://tiler.example', sourceUrl: 'https://data.example/jrc/2020.tif', paint: PAINT },
      },
      [{ time: Date.UTC(2020, 0, 1), end: null, url: 'https://data.example/jrc/2020.tif' }]
    )!;
    expect(raster).toMatchObject({ kind: 'painted', paint: PAINT });
    const scenes = scenesOfFrame(
      createDataFrame({
        fields: [
          { name: 'raster_url', type: FieldType.string, values: ['https://data.example/a.tif'] },
          { name: 'raster_painted', type: FieldType.boolean, values: [true] },
          { name: 'raster_paint', type: FieldType.string, values: [PAINT] },
        ],
      })
    );
    expect(scenes).toMatchObject({ painted: true, paint: PAINT });
  });

  it("hands kepler an archive under this Grafana's proxy as a whole address, which a worker can fetch", () => {
    expect(loadableUrl('/api/datasources/proxy/uid/m/catalog/a.pmtiles', 'https://grafana.example')).toBe(
      'https://grafana.example/api/datasources/proxy/uid/m/catalog/a.pmtiles'
    );
    expect(loadableUrl(TILES.href, 'https://grafana.example')).toBe(TILES.href);
    expect(loadableUrl('//cdn.example/a.pmtiles', 'https://grafana.example')).toBe('//cdn.example/a.pmtiles');
  });
});
