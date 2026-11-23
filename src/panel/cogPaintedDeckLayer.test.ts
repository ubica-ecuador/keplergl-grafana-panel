jest.mock('@deck.gl/geo-layers', () => ({ TileLayer: class {} }));
jest.mock('@deck.gl/layers', () => ({ BitmapLayer: class {} }));

import { mosaicTile, touches } from './cogPaintedDeckLayer';

const tile = { index: { x: 3, y: 5, z: 4 }, bbox: { west: 0.5, south: 0.2, east: 0.9, north: 0.8 } };
const image = (name: string) => ({ name, width: 256, height: 256 }) as unknown as ImageBitmap;

describe('a mosaic tile', () => {
  it('asks only the pieces whose box touches the tile, with the tile in their url', async () => {
    const asked: string[] = [];
    const load = async (url: string) => {
      asked.push(url);
      return image(url);
    };
    const parts = [
      { template: 'a/{z}/{x}/{y}.png', bbox: [0, 0, 1, 1] as [number, number, number, number] },
      { template: 'far/{z}/{x}/{y}.png', bbox: [5, 5, 6, 6] as [number, number, number, number] },
      { template: 'anywhere/{z}/{x}/{y}.png', bbox: null },
    ];
    const drawn = await mosaicTile(parts, tile, load);
    expect(asked).toEqual(['a/4/3/5.png', 'anywhere/4/3/5.png']);
    expect(drawn).toBeInstanceOf(HTMLCanvasElement);
  });

  it('is the one image when one piece answers, and nothing when none does', async () => {
    const one = await mosaicTile(
      [
        { template: 'a/{z}/{x}/{y}.png', bbox: null },
        { template: 'b/{z}/{x}/{y}.png', bbox: null },
      ],
      tile,
      async (url) => (url.startsWith('a') ? image('a') : null)
    );
    expect(one).toEqual(image('a'));
    expect(await mosaicTile([{ template: 'a/{z}/{x}/{y}.png', bbox: null }], tile, async () => null)).toBeNull();
  });

  it('touches by box, and a piece without one everywhere', () => {
    expect(touches([0, 0, 1, 1], tile.bbox)).toBe(true);
    expect(touches([1, 0, 2, 1], tile.bbox)).toBe(false);
    expect(touches(null, tile.bbox)).toBe(true);
  });
});
