import { FieldType, toDataFrame } from '@grafana/data';

import { framesToRasters } from './rasterDataset';

const SERVER = 'http://titiler.test';
const COG = 'https://bucket.example/scenes/2026/TCI.tif';

function rasterFrame(url: string, refId = 'A') {
  return toDataFrame({
    refId,
    fields: [{ name: 'raster_url', type: FieldType.string, values: [url] }],
  });
}

describe('framesToRasters', () => {
  it('describes the raster a query points at', () => {
    const [raster] = framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [SERVER] });

    expect(raster).toMatchObject({
      id: 'grafana-A-raster',
      cogUrl: COG,
      tileServerUrls: [SERVER],
    });
  });

  it('builds the metadata url titiler answers on', () => {
    const [raster] = framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [SERVER] });

    expect(raster.metadataUrl).toBe(`${SERVER}/cog/stac?url=${encodeURIComponent(COG)}`);
  });

  it('percent-encodes a href carrying its own query string', () => {
    // A signed url brings ? and & of its own; left raw they would be read as
    // titiler's parameters and the scene would resolve to nothing.
    const signed = 'https://bucket.example/a.tif?X-Amz-Expires=60&X-Amz-Signature=abc';
    const [raster] = framesToRasters([rasterFrame(signed)], {}, { tileServerUrls: [SERVER] });

    expect(raster.metadataUrl).toBe(`${SERVER}/cog/stac?url=${encodeURIComponent(signed)}`);
    expect(raster.metadataUrl).not.toContain('&X-Amz-Signature');
  });

  it('takes the first row when a query returns several scenes', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [{ name: 'raster_url', type: FieldType.string, values: [COG, 'https://bucket.example/other.tif'] }],
    });

    expect(framesToRasters([frame], {}, { tileServerUrls: [SERVER] })[0].cogUrl).toBe(COG);
  });

  it('lets an override point the role at another column', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'raster_url', type: FieldType.string, values: ['https://bucket.example/wrong.tif'] },
        { name: 'preview', type: FieldType.string, values: [COG] },
      ],
    });

    expect(framesToRasters([frame], { A: { rasterUrl: 'preview' } }, { tileServerUrls: [SERVER] })[0].cogUrl).toBe(COG);
  });

  it('produces nothing for a query whose raster role is switched off', () => {
    expect(framesToRasters([rasterFrame(COG)], { A: { rasterUrl: null } }, { tileServerUrls: [SERVER] })).toEqual([]);
  });

  it('produces nothing when the url is empty', () => {
    expect(framesToRasters([rasterFrame('   ')], {}, { tileServerUrls: [SERVER] })).toEqual([]);
  });

  it('produces nothing when no tile server is configured', () => {
    // Without a server kepler's own layer throws 'No raster tile servers'
    // mid-render; refusing to build the dataset keeps that out of the map.
    expect(framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [] })).toEqual([]);
  });

  it('names the dataset after the query', () => {
    const frame = toDataFrame({
      refId: 'B',
      name: 'Sentinel-2',
      fields: [{ name: 'raster_url', type: FieldType.string, values: [COG] }],
    });

    expect(framesToRasters([frame], {}, { tileServerUrls: [SERVER] })[0]).toMatchObject({
      id: 'grafana-B-raster',
      label: 'Sentinel-2',
    });
  });

  it('ignores queries that carry no raster url', () => {
    const plain = toDataFrame({
      refId: 'A',
      fields: [{ name: 'latitude', type: FieldType.number, values: [-2.9] }],
    });

    expect(framesToRasters([plain, rasterFrame(COG, 'B')], {}, { tileServerUrls: [SERVER] })).toHaveLength(1);
  });
});
