import { holdTilesetFraming, restoredTilesetIds } from './tile3dFraming';

/**
 * A kepler layer as the store holds it. Only three things about it matter here:
 * its `type`, the dataset it draws, and the private flag kepler's 3D tile layer
 * sets once it has framed the map around its tileset.
 */
function layer(type: string, dataId: string, fitted?: boolean): Record<string, unknown> {
  const base = { type, config: { dataId } };
  return fitted === undefined ? base : { ...base, _hasFittedBounds: fitted };
}

/** The dataset the provisioned `tile3d` board restores. */
const RESTORED = new Set(['agi-hq-mesh']);

describe('holdTilesetFraming', () => {
  it('stops a restored 3D tileset from re-framing a map that already has its viewport', () => {
    // Measured on the provisioned `tile3d` board: the saved zoom of 18.4 was
    // applied, and replaced by 16.27 the moment `tileset.json` arrived — on four
    // clean loads out of four. The pitch survived; the zoom never did.
    const mesh = layer('tile3d', 'agi-hq-mesh', false);

    expect(holdTilesetFraming([mesh], RESTORED)).toBe(1);
    expect(mesh._hasFittedBounds).toBe(true);
  });

  it('holds a layer that has not set the flag at all yet', () => {
    // kepler defines the flag in the constructor, but a layer this code sees
    // is not obliged to be one kepler built.
    const mesh = layer('tile3d', 'agi-hq-mesh');

    expect(holdTilesetFraming([mesh], RESTORED)).toBe(1);
    expect(mesh._hasFittedBounds).toBe(true);
  });

  it('leaves a tileset added by hand alone, even while the load window is open', () => {
    // The hold runs on every store change of the load window, because the
    // restored layers only appear once kepler's dataset tasks settle. So a
    // tileset added through Add Data in those same seconds is in the store too.
    // Its dataset is not one the saved config restores, and it has every right
    // to frame the map — that is what adding it by hand asks for.
    const added = layer('tile3d', '3la57e1nb', false);

    expect(holdTilesetFraming([added], RESTORED)).toBe(0);
    expect(added._hasFittedBounds).toBe(false);
  });

  it('leaves every other layer alone', () => {
    // Row layers are framed — or not — by `addDataToMap`'s `centerMap`, which
    // the load path already sets from the saved config. Only the 3D tile layer
    // frames later, on its own, and so only it needs holding.
    const points = layer('point', 'agi-hq-mesh');
    const vector = layer('vectorTile', 'agi-hq-mesh', false);

    expect(holdTilesetFraming([points, vector], RESTORED)).toBe(0);
    expect(points).not.toHaveProperty('_hasFittedBounds');
    expect(vector._hasFittedBounds).toBe(false);
  });

  it('counts only the layers it actually held', () => {
    // It runs on every store change of the window, so the count has to fall to
    // zero once the work is done rather than repeat itself.
    const layers = [layer('tile3d', 'agi-hq-mesh', true), layer('tile3d', 'agi-hq-mesh', false)];

    expect(holdTilesetFraming(layers, RESTORED)).toBe(1);
    expect(holdTilesetFraming(layers, RESTORED)).toBe(0);
  });

  it('does nothing without layers, or without a tileset to restore', () => {
    expect(holdTilesetFraming(undefined, RESTORED)).toBe(0);
    expect(holdTilesetFraming(null, RESTORED)).toBe(0);
    expect(holdTilesetFraming([null, undefined, 42, 'tile3d', { type: 'tile3d' }], RESTORED)).toBe(0);
    expect(holdTilesetFraming([layer('tile3d', 'agi-hq-mesh', false)], new Set())).toBe(0);
  });
});

describe('restoredTilesetIds', () => {
  it('lists the 3D tilesets a saved config restores, and nothing else', () => {
    const config = {
      version: 'v1',
      config: {},
      datasets: [
        { version: 'v1', data: { id: 'agi-hq-mesh', type: 'tile-3d' } },
        { version: 'v1', data: { id: 'roads', type: 'vector-tile' } },
      ],
    };

    expect([...restoredTilesetIds(config)]).toEqual(['agi-hq-mesh']);
  });

  it('is empty when there is no config, or it restores no datasets', () => {
    expect(restoredTilesetIds(null).size).toBe(0);
    expect(restoredTilesetIds(undefined).size).toBe(0);
    expect(restoredTilesetIds({ version: 'v1', config: {} }).size).toBe(0);
  });

  it('skips entries it cannot read rather than throwing on them', () => {
    // A hand-edited dashboard is the usual source of these, and an exception
    // here would take the viewport guard down with it on every store change.
    const config = { version: 'v1', config: {}, datasets: [null, {}, { data: null }, { data: { type: 'tile-3d' } }] };

    expect(restoredTilesetIds(config as never).size).toBe(0);
  });
});
