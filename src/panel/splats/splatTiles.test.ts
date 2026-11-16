import { GaussianSplatLayer, invert, packSplats, toHalf } from './gaussianSplatLayer';
import { baseAltitude } from '../tile3dAltitude';
import {
  enuToEcef,
  isSplatTile,
  noteSplatBase,
  coveredBy,
  orderSplatLayers,
  splatTileBase,
  splatTileLayers,
  tilesGivingWay,
} from './splatTiles';
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
  /** A tile in a tree: drawn or not, in view or not, with these children. */
  function node(id: string, children: any[] = [], extra: Record<string, unknown> = {}): any {
    const tile: any = { id, children, refine: 2, isVisibleAndInRequestVolume: true, ...extra };
    for (const child of children) {
      child.parent = tile;
    }
    return tile;
  }

  it('gives way to finer tiles once every child in view is drawn', () => {
    const a = node('a');
    const b = node('b');
    const root = node('root', [a, b]);
    expect([...tilesGivingWay(new Set([root, a, b]))]).toEqual([root]);
  });

  it('is drawn alone, the finer tiles left out, while a child in view is not', () => {
    const a = node('a');
    const b = node('b');
    const root = node('root', [a, b]);
    const hidden = tilesGivingWay(new Set([root, a]));
    expect(hidden.has(root)).toBe(false);
    expect(hidden.has(a)).toBe(true);
  });

  it('is not held back by a child out of view, nor by an empty one', () => {
    const a = node('a');
    const away = node('away', [], { isVisibleAndInRequestVolume: false });
    const empty = node('empty', [], { hasEmptyContent: true });
    const root = node('root', [a, away, empty]);
    expect(tilesGivingWay(new Set([root, a])).has(root)).toBe(true);
  });

  it('is held back by an external tileset not loaded yet', () => {
    const a = node('a');
    const external = node('external', [], { hasTilesetContent: true });
    const root = node('root', [a, external]);
    expect(tilesGivingWay(new Set([root, a])).has(root)).toBe(false);
  });

  it('counts a child covered by its own children', () => {
    const g1 = node('g1');
    const g2 = node('g2');
    const child = node('child', [g1, g2]);
    const other = node('other');
    const root = node('root', [child, other]);
    // The child itself is not drawn: its two children are.
    const hidden = tilesGivingWay(new Set([root, other, g1, g2]));
    expect(hidden.has(root)).toBe(true);
    expect(hidden.has(g1) || hidden.has(g2) || hidden.has(other)).toBe(false);
    expect(coveredBy(child, new Set([g1]))).toBe(false);
  });

  it('leaves a tile that adds to its parent drawn with it', () => {
    const a = node('a');
    const root = node('root', [a], { refine: 1 });
    expect(tilesGivingWay(new Set([root, a])).size).toBe(0);
  });

  it('hides the layers of the tiles that give way, and keeps their state', () => {
    const viewport = { cameraPosition: [0, 0, 0], projectPosition: (p: number[]) => p };
    const child = tile('c', [1, 0, 0]);
    const parent = { ...tile('p', [2, 0, 0]), refine: 2, children: [child], selected: true };
    child.parent = parent;
    child.selected = true;
    child.isVisibleAndInRequestVolume = true;
    const [coarse] = splatTileLayers(parent, 'tiles', {});
    const [fine] = splatTileLayers(child, 'tiles', {});
    const ordered = orderSplatLayers([coarse, fine], viewport) as GaussianSplatLayer[];
    expect(ordered.find((l) => l.id === coarse.id)!.props.visible).toBe(false);
    expect(ordered.find((l) => l.id === fine.id)!.props.visible).not.toBe(false);
  });
});

describe('a tileset of splats grounded by its splats', () => {
  /** A tile placed east-north-up at Portcoast, 21 m under the ellipsoid, with splats from 0 to 10 m up in glTF's y and a few strays 50 m down. */
  function placedTile(height = -21) {
    const count = 1000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (i % 37) - 18;
      positions[i * 3 + 1] = i < 10 ? -50 : ((i * 7) % 100) / 10;
      positions[i * 3 + 2] = (i % 23) - 11;
    }
    const splats = { ...SPLATS, count, positions };
    return {
      id: 't',
      transform: enuToEcef(108.8, 15.39, height),
      content: { splats: [{ splats, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }], gltfUpAxis: 'Y' },
    } as any;
  }

  it('finds the ground under the splats, past a few strays below it', () => {
    const base = splatTileBase(placedTile())!;
    expect(base).toBeGreaterThan(-21.5);
    expect(base).toBeLessThan(-20.5);
  });

  it('reads the tile as its tileset states it, whatever the panel has moved since', () => {
    const tile = placedTile();
    // What grounding changes: the tileset's model matrix and the content's matrices, not the tree's transforms.
    tile.tileset = { modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 200, 300, 1] };
    tile.content.modelMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, 9, 9, 1];
    expect(splatTileBase(tile)).toBeCloseTo(splatTileBase(placedTile())!, 6);
  });

  it('only ever lowers the base, and the base grounds the tileset', () => {
    const tileset: any = {
      cartographicCenter: [108.8, 15.39, 900],
      root: { header: { boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 933] } } },
    };
    expect(noteSplatBase(tileset, placedTile(-21))).toBe(true);
    expect(noteSplatBase(tileset, placedTile(-10))).toBe(false);
    expect(noteSplatBase(tileset, placedTile(-30))).toBe(true);
    expect(tileset.splatBase).toBeLessThan(-29.5);
    // Not 900 − 933 from the loose box.
    expect(baseAltitude(tileset)).toBe(tileset.splatBase);
  });

  it('leaves a tileset where it is while its only box lies along the axes of ECEF', () => {
    // Esri's Portcoast root: a box along ECEF's axes, 933 m along Z, at 15° N.
    const esri: any = {
      cartographicCenter: [108.8, 15.39, -22],
      root: { header: { boundingVolume: { box: [-1981945, 5822908, 1681477, 529, 0, 0, 0, 359, 0, 0, 0, 933] } } },
    };
    expect(baseAltitude(esri)).toBeNull();
    // A box whose third axis points up there keeps its half-height.
    const up = enuToEcef(108.8, 15.39, 0).slice(8, 11);
    const upright: any = {
      cartographicCenter: [108.8, 15.39, 100],
      root: { header: { boundingVolume: { box: [0, 0, 0, 50, 0, 0, 0, 50, 0, ...up.map((v) => v * 30)] } } },
    };
    expect(baseAltitude(upright)).toBeCloseTo(70, 6);
  });
});
