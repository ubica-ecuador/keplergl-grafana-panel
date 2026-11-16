import { GaussianSplatLayer, invert, packSplats, toHalf } from './gaussianSplatLayer';
import { enuToEcef, isSplatTile, orderSplatLayers, replacedBoxes, splatTileLayers } from './splatTiles';
import type { Splats } from './spz';

const SPLATS: Splats = {
  count: 2,
  positions: new Float32Array([1, 2, 3, 4, 5, 6]),
  scales: new Float32Array([0.1, 0.2, 0.3, 1, 1, 1]),
  rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
  colors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]),
  antialiased: true,
};

const TRANSLATE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];

function tile(id: string, origin: number[]) {
  return {
    id,
    content: { splats: [{ splats: SPLATS, matrix: TRANSLATE }], cartographicOrigin: origin, modelMatrix: TRANSLATE },
  } as any;
}

describe('tiles of splats', () => {
  it('are told apart by their content', () => {
    expect(isSplatTile(tile('a', [0, 0, 0]))).toBe(true);
    expect(isSplatTile({ id: 'b', content: { gltf: {} } } as any)).toBe(false);
    expect(isSplatTile({ id: 'c', content: null })).toBe(false);
  });

  it('get a splat layer per primitive, placed as deck places a glTF tile', () => {
    const t = tile('a', [108.8, 15.39, 0]);
    const [layer] = splatTileLayers(t, 'tiles', { opacity: 0.5 });
    expect(layer).toBeInstanceOf(GaussianSplatLayer);
    expect(layer.props.coordinateSystem).toBe('meter-offsets');
    expect(layer.props.coordinateOrigin).toEqual([108.8, 15.39, 0]);
    // The tile's model matrix, then the glTF node's.
    expect(Array.from(layer.props.modelMatrix as any)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 20, 40, 60, 1]);
    expect(layer.props.opacity).toBe(0.5);
    expect((layer.props as any).tile).toBe(t);
    layer.props.onFirstDraw!();
    expect(t.tileDrawn).toBe(true);
  });

  it('mark a tile with no readable splats as drawn, so the tiles it replaces go', () => {
    const empty = { id: 'e', content: { splats: [] } } as any;
    expect(splatTileLayers(empty, 'tiles', {})).toEqual([]);
    expect(empty.tileDrawn).toBe(true);
  });

  it('are drawn farthest first, after every other layer', () => {
    const near = splatTileLayers(tile('near', [1, 0, 0]), 'tiles', {})[0];
    const far = splatTileLayers(tile('far', [9, 0, 0]), 'tiles', {})[0];
    const mesh = { id: 'mesh' };
    const viewport = { cameraPosition: [0, 0, 0], projectPosition: (p: number[]) => p };
    expect(orderSplatLayers([[near], mesh, [far]], viewport)).toEqual([mesh, far, near]);
    expect(orderSplatLayers([mesh], viewport)).toEqual([mesh]);
    expect(orderSplatLayers(null, viewport)).toBeNull();
  });
});

describe('the splat layer', () => {
  it('packs centre, colour, spread and orientation into its two textures', () => {
    const packed = packSplats(SPLATS, 4);
    expect([packed.width, packed.height]).toEqual([2, 1]);
    const floats = new Float32Array(packed.centers.buffer);
    expect(Array.from(floats.subarray(4, 7))).toEqual([4, 5, 6]);
    // r | g << 8 | b << 16 | a << 24, as the shader reads it.
    expect(packed.centers[7]).toBe((0 | (255 << 8) | (0 << 16) | (128 << 24)) >>> 0);
    // Scales as half floats, two to a channel: 0.1 and 0.2.
    expect(packed.shapes[0] & 0xffff).toBe(toHalf(0.1));
    expect(packed.shapes[0] >>> 16).toBe(toHalf(0.2));
    // The identity quaternion's w, as snorm16: 32767.
    expect(packed.shapes[3] >>> 16).toBe(32767);
  });

  it('inverts the model matrix it finds the eye through', () => {
    const inverse = invert(TRANSLATE)!;
    expect(inverse.slice(12)).toEqual([-10, -20, -30, 1]);
    expect(invert(new Array(16).fill(0))).toBeNull();
  });

  it('writes half floats as IEEE binary16', () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(0.1)).toBe(0x2e66);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(toHalf(1e-5)).toBe(0x00a8);
  });
});

describe('one level of detail at a time', () => {
  const ORIGIN = [108.8, 15.39, -20];
  const enu = enuToEcef(ORIGIN[0], ORIGIN[1], ORIGIN[2]);
  /** A point east, north, up of the origin, in ECEF. */
  const ecefAt = (e: number, n: number, u: number) =>
    [0, 1, 2].map((r) => enu[r] * e + enu[4 + r] * n + enu[8 + r] * u + enu[12 + r]);

  it('puts the box of a finer tile in the space of the coarser one', () => {
    // The coarse layer's space turned as Esri's tiles are (z up to y up) and lifted 20 m.
    const turned = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 20, 1];
    const layer = new GaussianSplatLayer({
      id: 'coarse',
      splats: SPLATS,
      coordinateOrigin: ORIGIN,
      modelMatrix: turned,
    } as any);
    const east = [enu[0], enu[1], enu[2]];
    const north = [enu[4], enu[5], enu[6]];
    const up = [enu[8], enu[9], enu[10]];
    const fine = {
      boundingVolume: {
        center: ecefAt(30, 40, 25),
        halfAxes: [...east.map((v) => v * 10), ...north.map((v) => v * 5), ...up.map((v) => v * 2)],
      },
    };
    const boxes = replacedBoxes(layer, [fine])!;
    expect(boxes).toHaveLength(12);
    // The model matrix takes (x, y, z) to east x, north z, up 20 − y: east 30, north 40, up 25 is (30, −5, 40).
    const [cx, cy, cz] = Array.from(boxes.subarray(0, 3));
    expect(cx).toBeCloseTo(30, 3);
    expect(cy).toBeCloseTo(-5, 3);
    expect(cz).toBeCloseTo(40, 3);
    // A splat 9 m east of the box's centre is inside it, 11 m is not.
    const inside = (p: number[]) => {
      const inv = boxes.subarray(3, 12);
      const d = [p[0] - cx, p[1] - cy, p[2] - cz];
      const q = [0, 1, 2].map((r) => inv[r] * d[0] + inv[3 + r] * d[1] + inv[6 + r] * d[2]);
      return Math.max(...q.map(Math.abs)) <= 1;
    };
    expect(inside([cx + 9, cy, cz])).toBe(true);
    expect(inside([cx + 11, cy, cz])).toBe(false);
  });

  it('leaves out of a drawn tile the boxes of the finer tiles drawn over it', () => {
    const parent: any = { id: 'p', refine: 2, selected: true, content: tile('p', ORIGIN).content };
    const child: any = {
      id: 'c',
      parent,
      selected: true,
      boundingVolume: { center: ecefAt(0, 0, 0), halfAxes: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      content: tile('c', ORIGIN).content,
    };
    const [coarse] = splatTileLayers(parent, 'tiles', {});
    const [fine] = splatTileLayers(child, 'tiles', {});
    const viewport = { cameraPosition: [0, 0, 0], projectPosition: (p: number[]) => p };
    const ordered = orderSplatLayers([coarse, fine], viewport) as GaussianSplatLayer[];
    const out = ordered.find((l) => l.id === coarse.id)!;
    expect(out.props.replaced).toHaveLength(12);
    expect(ordered.find((l) => l.id === fine.id)!.props.replaced ?? null).toBeNull();
  });
});
