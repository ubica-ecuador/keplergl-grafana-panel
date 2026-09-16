import { FieldType, toDataFrame } from '@grafana/data';

import { framesToRasters, isPanelRasterId, pickScene, rasterForWindow } from './rasterDataset';

const VISUAL = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/…/TCI.tif';
const ITEM = 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2C_10SEJ_20260913_0_L2A';

function sceneFrame(withItem = true) {
  const fields: any[] = [{ name: 'raster_url', type: 'string', values: [VISUAL] }];
  if (withItem) {
    fields.push({ name: 'raster_item_url', type: 'string', values: [ITEM] });
  }
  return { refId: 'A', name: 'Query A', fields, length: 1 } as any;
}

// Named apart from the file's existing `SERVER` (a bare url string): band
// combinations are read from `opts`, and every test below spreads this as its
// base.
const BAND_OPTS = { tileServerUrls: ['https://titiler.ubica.ec'] };

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
      sourceUrl: COG,
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

  it('marks the raster painted when the panel asked the server to do the colouring', () => {
    // kepler's own raster layer cannot draw a classified image: it fetches raw
    // arrays and rescales 1-11 over the whole uint8 range, so every class lands
    // on one colour. Painted rasters go to the layer that asks the tile server
    // for a PNG instead.
    const [raster] = framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [SERVER], painted: true });

    expect(raster.kind).toBe('painted');
  });

  it('needs no STAC document when the server paints', () => {
    // Nothing fetches metadata on that path — the tile url is built from the
    // image url directly — so the identity a refresh compares on is the image.
    const [raster] = framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [SERVER], painted: true });

    expect(raster.metadataUrl).toBe(COG);
  });

  it('leaves a PMTiles archive alone when painting is asked for', () => {
    // An archive is already drawn tiles; it never wanted a server, and routing
    // it through one would ask for a COG that does not exist.
    const archive = 'https://bucket.example/lulc.pmtiles';
    const [raster] = framesToRasters([rasterFrame(archive)], {}, { tileServerUrls: [SERVER], painted: true });

    expect(raster.kind).toBe('pmtiles');
  });

  it('drops a painted raster when there is no server to paint it', () => {
    // Painting is the server's job on this path, so with nowhere to send the
    // request there is no layer to build. Left in, every tile of every zoom
    // would ask a malformed url and answer 404, in silence.
    const rasters = framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [], painted: true });

    expect(rasters).toHaveLength(0);
  });

  it('takes the first row when a query returns several scenes', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [{ name: 'raster_url', type: FieldType.string, values: [COG, 'https://bucket.example/other.tif'] }],
    });

    expect(framesToRasters([frame], {}, { tileServerUrls: [SERVER] })[0].sourceUrl).toBe(COG);
  });

  it('lets an override point the role at another column', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'raster_url', type: FieldType.string, values: ['https://bucket.example/wrong.tif'] },
        { name: 'preview', type: FieldType.string, values: [COG] },
      ],
    });

    expect(framesToRasters([frame], { A: { rasterUrl: 'preview' } }, { tileServerUrls: [SERVER] })[0].sourceUrl).toBe(
      COG
    );
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
    { time: Date.UTC(2026, 6, 1), sourceUrl: 'https://b/jul01.tif', itemUrl: null },
    { time: Date.UTC(2026, 6, 11), sourceUrl: 'https://b/jul11.tif', itemUrl: null },
    { time: Date.UTC(2026, 6, 21), sourceUrl: 'https://b/jul21.tif', itemUrl: null },
  ];

  it('takes the last scene inside the window', () => {
    const window = { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 6, 15) };

    expect(pickScene(scenes, window)?.sourceUrl).toBe('https://b/jul11.tif');
  });

  it('ignores scenes the window has not reached yet', () => {
    // Dragging the slider back in time must show what was there then, not the
    // newest image the query happened to return.
    const window = { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 6, 5) };

    expect(pickScene(scenes, window)?.sourceUrl).toBe('https://b/jul01.tif');
  });

  it('finds nothing when the window falls between passes', () => {
    const window = { from: Date.UTC(2026, 6, 2), to: Date.UTC(2026, 6, 9) };

    expect(pickScene(scenes, window)).toBeNull();
  });

  it('takes the most recent scene when there is no window', () => {
    expect(pickScene(scenes, null)?.sourceUrl).toBe('https://b/jul21.tif');
  });

  it('takes the first row when the scenes carry no time at all', () => {
    // A query that returns one scene and no time column is the ordinary case,
    // and it must keep behaving as it did before the timeline existed.
    const undated = [
      { time: null, sourceUrl: 'https://b/first.tif', itemUrl: null },
      { time: null, sourceUrl: 'https://b/second.tif', itemUrl: null },
    ];

    expect(pickScene(undated, { from: 0, to: 1 })?.sourceUrl).toBe('https://b/first.tif');
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
      { time: Date.UTC(2026, 6, 1), sourceUrl: 'https://b/jul01.tif', itemUrl: null },
      { time: Date.UTC(2026, 6, 21), sourceUrl: 'https://b/jul21.tif', itemUrl: null },
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

    expect(framesToRasters([frame], {}, { tileServerUrls: [SERVER] })[0].sourceUrl).toBe('https://b/jul21.tif');
  });

  it('still takes the first row when the query has no time column', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [{ name: 'raster_url', type: FieldType.string, values: [COG, 'https://b/other.tif'] }],
    });

    expect(framesToRasters([frame], {}, { tileServerUrls: [SERVER] })[0].sourceUrl).toBe(COG);
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

    expect(moved?.sourceUrl).toBe('https://b/jul01.tif');
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

describe('isPanelRasterId', () => {
  it('tells the panel’s own rasters from a hand-added tileset', () => {
    // Only ids the panel minted are its to replace, to remove, and to keep out
    // of a saved dashboard.
    expect(isPanelRasterId('grafana-A-raster')).toBe(true);
    expect(isPanelRasterId('pawlsg7ej')).toBe(false);
  });
});

describe('framesToRasters — colormap', () => {
  it('carries the colormap the panel chose', () => {
    const [raster] = framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [SERVER], colormap: 'blues' });

    expect(raster.colormap).toBe('blues');
  });

  it('leaves it unset when the panel has no preference', () => {
    // Unset means "whatever kepler defaults to", not a hardcoded choice: the
    // panel must not silently restyle a raster nobody asked it to.
    const [raster] = framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [SERVER] });

    expect(raster.colormap).toBeUndefined();
  });

  it('keeps the colormap when the window moves to another scene', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'time', type: FieldType.time, values: [Date.UTC(2026, 6, 1), Date.UTC(2026, 6, 21)] },
        { name: 'raster_url', type: FieldType.string, values: ['https://b/a.tif', 'https://b/b.tif'] },
      ],
    });
    const [raster] = framesToRasters([frame], {}, { tileServerUrls: [SERVER], colormap: 'blues' });

    expect(rasterForWindow(raster, { from: 0, to: Date.UTC(2026, 6, 10) })?.colormap).toBe('blues');
  });
});

const PMTILES = 'https://bucket.example/scenes/2026/rain.pmtiles';

describe('framesToRasters — PMTiles', () => {
  it('needs no tile server at all', () => {
    // The whole point of the format: kepler reads the archive itself over
    // range requests, so an install with nowhere to run TiTiler still draws.
    const [raster] = framesToRasters([rasterFrame(PMTILES)], {}, { tileServerUrls: [] });

    expect(raster).toMatchObject({ kind: 'pmtiles', sourceUrl: PMTILES, tileServerUrls: [] });
  });

  it('points the metadata straight at the archive', () => {
    const [raster] = framesToRasters([rasterFrame(PMTILES)], {}, { tileServerUrls: [SERVER] });

    expect(raster.metadataUrl).toBe(PMTILES);
  });

  it('ignores a configured server, which cannot serve it anyway', () => {
    expect(framesToRasters([rasterFrame(PMTILES)], {}, { tileServerUrls: [SERVER] })[0].tileServerUrls).toEqual([]);
  });

  it('recognises an archive behind a query string', () => {
    const signed = 'https://bucket.example/rain.pmtiles?token=abc';
    expect(framesToRasters([rasterFrame(signed)], {}, { tileServerUrls: [] })[0].kind).toBe('pmtiles');
  });

  it('marks a COG as one, so the two paths never blur', () => {
    expect(framesToRasters([rasterFrame(COG)], {}, { tileServerUrls: [SERVER] })[0].kind).toBe('cog');
  });

  it('drops only the queries that need the missing server', () => {
    // A dashboard may hold both, and losing the archive because a COG beside
    // it has nowhere to be served would be a strange kind of solidarity.
    const rasters = framesToRasters([rasterFrame(COG, 'A'), rasterFrame(PMTILES, 'B')], {}, { tileServerUrls: [] });

    expect(rasters.map((raster) => raster.id)).toEqual(['grafana-B-raster']);
  });

  it('follows the window without inventing a server url', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'time', type: FieldType.time, values: [1000, 2000] },
        { name: 'raster_url', type: FieldType.string, values: [PMTILES, 'https://bucket.example/b.pmtiles'] },
      ],
    });
    const [raster] = framesToRasters([frame], {}, { tileServerUrls: [] });

    const picked = rasterForWindow(raster, { from: 0, to: 1500 });

    expect(picked).toMatchObject({ sourceUrl: PMTILES, metadataUrl: PMTILES });
  });
});

describe('framesToRasters with band combinations', () => {
  it('draws true colour exactly as before: the composed image, through kepler', () => {
    const [raster] = framesToRasters([sceneFrame()], {}, { ...BAND_OPTS, bands: 'trueColor' });
    expect(raster.kind).toBe('cog');
    expect(raster.sourceUrl).toBe(VISUAL);
    expect(raster.metadataUrl).toContain('/cog/stac?url=');
    expect(raster.assets).toBeUndefined();
  });

  it('is unchanged when no combination is asked for', () => {
    const [withOption] = framesToRasters([sceneFrame()], {}, { ...BAND_OPTS, bands: 'trueColor' });
    const [without] = framesToRasters([sceneFrame()], {}, BAND_OPTS);
    expect(without).toEqual(withOption);
  });

  it('paints a composite from the item, carrying its assets and stretches', () => {
    const [raster] = framesToRasters([sceneFrame()], {}, { ...BAND_OPTS, bands: 'forestBurn' });
    expect(raster.kind).toBe('painted');
    expect(raster.sourceUrl).toBe(ITEM);
    expect(raster.assets).toEqual(['swir22', 'nir', 'blue']);
    expect(raster.rescale).toHaveLength(3);
    // The identity a refresh compares on is the tile request itself.
    expect(raster.metadataUrl).toContain('/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?');
    expect(raster.metadataUrl).toContain('assets=swir22');
  });

  it('gives two composites different identities, so switching repaints', () => {
    const [burn] = framesToRasters([sceneFrame()], {}, { ...BAND_OPTS, bands: 'forestBurn' });
    const [infrared] = framesToRasters([sceneFrame()], {}, { ...BAND_OPTS, bands: 'infrared' });
    expect(burn.metadataUrl).not.toBe(infrared.metadataUrl);
  });

  it('hands an index to kepler as the item itself, with its preset and ramp', () => {
    const [raster] = framesToRasters([sceneFrame()], {}, { ...BAND_OPTS, bands: 'nbr' });
    expect(raster.kind).toBe('stac');
    expect(raster.sourceUrl).toBe(ITEM);
    expect(raster.metadataUrl).toBe(ITEM);
    expect(raster.preset).toBe('nbr');
    expect(raster.colormap).toBe('rdylgn');
  });

  it('gives the two indices the same identity on purpose: only the style differs', () => {
    const [nbr] = framesToRasters([sceneFrame()], {}, { ...BAND_OPTS, bands: 'nbr' });
    const [ndmi] = framesToRasters([sceneFrame()], {}, { ...BAND_OPTS, bands: 'ndmi' });
    expect(ndmi.metadataUrl).toBe(nbr.metadataUrl);
    expect(ndmi.preset).toBe('ndmi');
    expect(ndmi.colormap).toBe('rdylbu');
  });

  it('falls back to true colour when the query carries no item', () => {
    const [raster] = framesToRasters([sceneFrame(false)], {}, { ...BAND_OPTS, bands: 'forestBurn' });
    expect(raster.kind).toBe('cog');
    expect(raster.sourceUrl).toBe(VISUAL);
    expect(raster.assets).toBeUndefined();
  });

  it('keeps every scene of the series, each with its own item', () => {
    const frame = {
      refId: 'A',
      fields: [
        { name: 'raster_url', type: 'string', values: [VISUAL, `${VISUAL}2`] },
        { name: 'raster_item_url', type: 'string', values: [ITEM, `${ITEM}2`] },
      ],
      length: 2,
    } as any;
    const [raster] = framesToRasters([frame], {}, { ...BAND_OPTS, bands: 'forestBurn' });
    expect(raster.scenes.map((scene) => scene.itemUrl)).toEqual([ITEM, `${ITEM}2`]);
  });
});
