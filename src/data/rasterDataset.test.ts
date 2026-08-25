import { FieldType, toDataFrame } from '@grafana/data';

import { framesToRasters, inSlot, isPanelRasterId, otherSlot, pickScene, rasterForWindow } from './rasterDataset';

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

describe('pickScene', () => {
  const scenes = [
    { time: Date.UTC(2026, 6, 1), cogUrl: 'https://b/jul01.tif' },
    { time: Date.UTC(2026, 6, 11), cogUrl: 'https://b/jul11.tif' },
    { time: Date.UTC(2026, 6, 21), cogUrl: 'https://b/jul21.tif' },
  ];

  it('takes the last scene inside the window', () => {
    const window = { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 6, 15) };

    expect(pickScene(scenes, window)?.cogUrl).toBe('https://b/jul11.tif');
  });

  it('ignores scenes the window has not reached yet', () => {
    // Dragging the slider back in time must show what was there then, not the
    // newest image the query happened to return.
    const window = { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 6, 5) };

    expect(pickScene(scenes, window)?.cogUrl).toBe('https://b/jul01.tif');
  });

  it('finds nothing when the window falls between passes', () => {
    const window = { from: Date.UTC(2026, 6, 2), to: Date.UTC(2026, 6, 9) };

    expect(pickScene(scenes, window)).toBeNull();
  });

  it('takes the most recent scene when there is no window', () => {
    expect(pickScene(scenes, null)?.cogUrl).toBe('https://b/jul21.tif');
  });

  it('takes the first row when the scenes carry no time at all', () => {
    // A query that returns one scene and no time column is the ordinary case,
    // and it must keep behaving as it did before the timeline existed.
    const undated = [
      { time: null, cogUrl: 'https://b/first.tif' },
      { time: null, cogUrl: 'https://b/second.tif' },
    ];

    expect(pickScene(undated, { from: 0, to: 1 })?.cogUrl).toBe('https://b/first.tif');
  });
});

describe('framesToRasters — a series of scenes', () => {
  it('carries every dated scene, oldest first', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'time', type: FieldType.time, values: [Date.UTC(2026, 6, 21), Date.UTC(2026, 6, 1)] },
        { name: 'raster_url', type: FieldType.string, values: ['https://b/jul21.tif', 'https://b/jul01.tif'] },
      ],
    });

    const [raster] = framesToRasters([frame], {}, { tileServerUrls: [SERVER] });

    expect(raster.scenes).toEqual([
      { time: Date.UTC(2026, 6, 1), cogUrl: 'https://b/jul01.tif' },
      { time: Date.UTC(2026, 6, 21), cogUrl: 'https://b/jul21.tif' },
    ]);
  });

  it('shows the most recent scene until a window says otherwise', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'time', type: FieldType.time, values: [Date.UTC(2026, 6, 1), Date.UTC(2026, 6, 21)] },
        { name: 'raster_url', type: FieldType.string, values: ['https://b/jul01.tif', 'https://b/jul21.tif'] },
      ],
    });

    expect(framesToRasters([frame], {}, { tileServerUrls: [SERVER] })[0].cogUrl).toBe('https://b/jul21.tif');
  });

  it('still takes the first row when the query has no time column', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [{ name: 'raster_url', type: FieldType.string, values: [COG, 'https://b/other.tif'] }],
    });

    expect(framesToRasters([frame], {}, { tileServerUrls: [SERVER] })[0].cogUrl).toBe(COG);
  });
});

describe('rasterForWindow', () => {
  const framed = () =>
    framesToRasters(
      [
        toDataFrame({
          refId: 'A',
          fields: [
            { name: 'time', type: FieldType.time, values: [Date.UTC(2026, 6, 1), Date.UTC(2026, 6, 21)] },
            { name: 'raster_url', type: FieldType.string, values: ['https://b/jul01.tif', 'https://b/jul21.tif'] },
          ],
        }),
      ],
      {},
      { tileServerUrls: [SERVER] }
    )[0];

  it('re-points the descriptor at the scene the window selects', () => {
    const moved = rasterForWindow(framed(), { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 6, 10) });

    expect(moved?.cogUrl).toBe('https://b/jul01.tif');
    expect(moved?.metadataUrl).toBe(`${SERVER}/cog/stac?url=${encodeURIComponent('https://b/jul01.tif')}`);
  });

  it('keeps the dataset id, so the swap replaces rather than adds', () => {
    const moved = rasterForWindow(framed(), { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 6, 10) });

    expect(moved?.id).toBe('grafana-A-raster');
  });

  it('returns nothing when the window holds no scene', () => {
    expect(rasterForWindow(framed(), { from: Date.UTC(2026, 6, 3), to: Date.UTC(2026, 6, 9) })).toBeNull();
  });
});

describe('raster slots', () => {
  it('recognises both slots as the panel’s own', () => {
    // Both must be excluded from a saved dashboard, and both must be removable
    // by the panel — a tileset the user added by hand is neither.
    expect(isPanelRasterId('grafana-A-raster')).toBe(true);
    expect(isPanelRasterId('grafana-A-raster-b')).toBe(true);
    expect(isPanelRasterId('pawlsg7ej')).toBe(false);
  });

  it('alternates between the two slots', () => {
    expect(otherSlot('grafana-A-raster')).toBe('grafana-A-raster-b');
    expect(otherSlot('grafana-A-raster-b')).toBe('grafana-A-raster');
  });

  it('re-points a descriptor at a given slot', () => {
    const [raster] = framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [SERVER] });
    const moved = inSlot(raster, 'grafana-A-raster-b');

    expect(moved.id).toBe('grafana-A-raster-b');
    // Everything else travels untouched: it is the same scene, in the other slot.
    expect(moved.cogUrl).toBe(raster.cogUrl);
    expect(moved.metadataUrl).toBe(raster.metadataUrl);
  });
});
