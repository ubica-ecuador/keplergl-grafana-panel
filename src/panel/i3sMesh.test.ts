import { readFileSync } from 'fs';
import { join } from 'path';

import {
  bakeI3sPositions,
  isI3sTile,
  isPbrMeshLayer,
  mendedClassOf,
  mendI3sMeshLayer,
  mendShaders,
  oneI3sLevelAtATime,
  UV_REGIONS_IF,
  UV_REGIONS_IFDEF,
  WHITE_VERTEX_COLOUR,
  ZERO_VERTEX_COLOUR,
} from './i3sMesh';

// deck.gl's own MeshLayer fragment shader, as the 3D tile layer draws an I3S tile with it (read as text: an ES module).
const deckFragment = readFileSync(
  join(process.cwd(), 'node_modules/@deck.gl/geo-layers/dist/mesh-layer/mesh-layer-fragment.glsl.js'),
  'utf8'
);
const deckVertex = readFileSync(
  join(process.cwd(), 'node_modules/@deck.gl/geo-layers/dist/mesh-layer/mesh-layer-vertex.glsl.js'),
  'utf8'
);

class FakeMeshLayer {
  static layerName = 'MeshLayer';
  props: Record<string, unknown>;
  constructor(props: Record<string, unknown>) {
    this.props = props;
  }
  getShaders() {
    return { vs: 'void main() {}', fs: `void main() { fragColor = vColor * ${ZERO_VERTEX_COLOUR}; }`, modules: [] };
  }
}

describe("deck.gl's MeshLayer for an I3S tile", () => {
  it('still hands the PBR module a zero vertex colour, which luma.gl 9.4 multiplies the texture by', () => {
    // When this fails, deck.gl has mended its shader: the mend here then does nothing and can go.
    expect(deckFragment).toContain(ZERO_VERTEX_COLOUR);
    expect(mendShaders({ fs: deckFragment }).fs).toContain(WHITE_VERTEX_COLOUR);
    expect(mendShaders({ fs: deckFragment }).fs).not.toContain(ZERO_VERTEX_COLOUR);
  });

  it('still tests for texture regions with #ifdef, though it defines the macro as 0 for a mesh without them', () => {
    // When this fails, deck.gl has mended its shader: the mend here then does nothing and can go.
    expect(deckVertex).toContain(UV_REGIONS_IFDEF);
    const mended = mendShaders({ vs: deckVertex, fs: deckFragment });
    expect(mended.vs).toContain(UV_REGIONS_IF + '\n');
    expect(mended.vs).not.toContain(UV_REGIONS_IFDEF);
    expect(mended.fs).toContain(WHITE_VERTEX_COLOUR);
  });

  it('is drawn with white for the vertex colour, its texture as it is', () => {
    const layer = new FakeMeshLayer({ id: 'mesh-1', pbrMaterial: { doubleSided: true }, mesh: {} });
    const mended = mendI3sMeshLayer(layer) as any;
    expect(mended).not.toBe(layer);
    expect(mended).toBeInstanceOf(FakeMeshLayer);
    expect(mended.props).toBe(layer.props);
    expect(mended.constructor.layerName).toBe('MeshLayer');
    expect(mended.getShaders().fs).toBe(`void main() { fragColor = vColor * ${WHITE_VERTEX_COLOUR}; }`);
    expect(mended.getShaders().vs).toBe('void main() {}');
    // Once mended, it stays as it is, and every tile shares one class.
    expect(mendI3sMeshLayer(mended)).toBe(mended);
    expect(mendedClassOf(FakeMeshLayer)).toBe(mendedClassOf(FakeMeshLayer));
  });

  it('leaves every other sublayer alone: a 3D Tiles scenegraph, a point cloud, a splat tile', () => {
    const scenegraph = { props: { id: 's', scenegraph: {} }, getShaders: () => ({ fs: ZERO_VERTEX_COLOUR }) };
    const splats = [{ props: { id: 'splats' } }];
    expect(isPbrMeshLayer(scenegraph)).toBe(false);
    expect(mendI3sMeshLayer(scenegraph)).toBe(scenegraph);
    expect(mendI3sMeshLayer(splats)).toBe(splats);
    expect(mendI3sMeshLayer(null)).toBeNull();
  });

  it('leaves a shader alone that does not make the call', () => {
    const shaders = { fs: 'void main() { fragColor = vec4(1.0); }' };
    expect(mendShaders(shaders)).toBe(shaders);
  });
});

describe("an I3S tile's vertices", () => {
  // loaders.gl's matrix for a tile at Government Point, California: ECEF turned east, north and up, the radius taken off.
  const modelMatrix = [
    0.862, 0.287, -0.418, 0, -0.507, 0.488, -0.711, 0, 0, 0.825, 0.566, 0, 0, 19939.285, -6371331.486, 1,
  ];
  const ecef = [
    -2668562.572146907, -4538738.013986837, 3587885.6219958593, -2668561.966033058, -4538738.155352835,
    3587885.4948462956,
  ];
  const apply = (m: number[], x: number, y: number, z: number, w = 1) => [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
  ];
  const tile = () => ({
    tileset: { type: 'I3S' },
    content: {
      attributes: {
        positions: { value: Float64Array.from(ecef), size: 3 },
        normals: { value: Float32Array.from([0, 0, 1, 1, 0, 0]), size: 3 },
      },
      modelMatrix: modelMatrix.slice(),
      cartographicModelMatrix: modelMatrix.slice(),
    },
  });

  it('are baked into metres round the tile origin in 64-bit floats, the matrix left as the identity', () => {
    const t = tile();
    expect(isI3sTile(t)).toBe(true);
    expect(bakeI3sPositions(t)).toBe(true);
    const baked = Array.from(t.content.attributes.positions.value as ArrayLike<number>);
    const expected = [
      ...apply(modelMatrix, ecef[0], ecef[1], ecef[2]),
      ...apply(modelMatrix, ecef[3], ecef[4], ecef[5]),
    ];
    baked.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 2));
    expect(t.content.attributes.positions.value).toBeInstanceOf(Float32Array);
    // Metres near the origin, not millions: what a 32-bit float keeps to a millimetre.
    baked.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e5));
    expect(Array.from(t.content.modelMatrix)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(Array.from(t.content.cartographicModelMatrix)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    // Normals are turned, not moved.
    const normals = Array.from(t.content.attributes.normals.value as ArrayLike<number>);
    const turned = [...apply(modelMatrix, 0, 0, 1, 0), ...apply(modelMatrix, 1, 0, 0, 0)];
    normals.forEach((v, i) => expect(v).toBeCloseTo(turned[i], 5));
  });

  it('are baked once: a tile already baked, or a 3D Tiles tile, is left', () => {
    const t = tile();
    bakeI3sPositions(t);
    const once = t.content.attributes.positions.value;
    expect(bakeI3sPositions(t)).toBe(false);
    expect(t.content.attributes.positions.value).toBe(once);
    expect(isI3sTile({ tileset: { type: 'TILES3D' } })).toBe(false);
    expect(bakeI3sPositions({ content: null })).toBe(false);
  });
});

describe('an I3S scene layer drawn one level of detail at a time', () => {
  class TileMesh {
    static layerName = 'MeshLayer';
    props: Record<string, any>;
    constructor(props: Record<string, any>) {
      this.props = props;
    }
    getShaders() {
      return {};
    }
    clone(props: Record<string, unknown>) {
      return new TileMesh({ ...this.props, ...props });
    }
  }
  const node = (id: string, parent: any = null, selected = true) => {
    const tile: any = {
      id,
      parent,
      children: [],
      selected,
      tileset: { type: 'I3S' },
      isVisibleAndInRequestVolume: true,
    };
    parent?.children.push(tile);
    return tile;
  };
  const layerOf = (tile: any) => new TileMesh({ id: `mesh-${tile.id}`, tile, pbrMaterial: {}, visible: true });
  const shown = (layers: any[] | null | undefined) =>
    (layers ?? []).filter((l) => l.props.visible !== false).map((l) => l.props.tile.id);

  it('leaves a coarse node out once every child of it in view is drawn', () => {
    const root = node('root');
    const a = node('a', root);
    const b = node('b', root);
    const away = node('away', root, false);
    away.isVisibleAndInRequestVolume = false;
    expect(shown(oneI3sLevelAtATime([root, a, b].map(layerOf)))).toEqual(['a', 'b']);
  });

  it('draws the coarse node alone while a child in view is not drawn yet', () => {
    const root = node('root');
    const a = node('a', root);
    node('b', root, false);
    const fine = node('fine', a);
    expect(shown(oneI3sLevelAtATime([root, a, fine].map(layerOf)))).toEqual(['root']);
  });

  it('leaves other layers, and a 3D Tiles mesh, as they came', () => {
    const layers = [{ props: { id: 'x' } }];
    expect(oneI3sLevelAtATime(layers)).toBe(layers);
    expect(oneI3sLevelAtATime(null)).toBeNull();
  });
});
