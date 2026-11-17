/**
 * I3S meshes (an ArcGIS scene layer: an integrated mesh, 3D objects) drawn by deck.gl's 3D tile layer, mended twice.
 *
 * **Their texture.** deck.gl draws an I3S tile with its own MeshLayer, in glTF's PBR material, unlit when the mesh
 * has a base colour texture. That layer's fragment shader asks luma.gl's PBR module for the colour with
 * `pbr_filterColor(vec4(0))`: the argument was ignored once, but luma.gl 9.4 multiplies the base colour by it, as
 * glTF's vertex colour. So every fragment came out (0, 0, 0, 0), fell under the material's alpha cutoff and was
 * discarded: the tiles loaded, the picking pass saw them, and nothing was drawn. deck.gl 9.4.1, the latest, and its
 * main branch still pass the zero. The vertex colour that argument stands for is already applied by the layer
 * (`vColor`, from the mesh's colours and `getColor`), so the shader is handed white instead: the texture's colour and
 * alpha, as glTF means them. Done on a subclass of whatever MeshLayer deck built, at the one place it is built
 * (`_getSubLayer`), since deck.gl does not export the class.
 *
 * **Their texture coordinates.** The same layer's vertex shader maps a coordinate into its region of a texture atlas
 * under `#ifdef HAS_UV_REGIONS`, and the layer always defines that macro: 1 when the mesh has `uvRegions`, 0 when it
 * has none. Defined as 0 is defined, so a mesh without regions (Esri's integrated meshes) has every coordinate mapped
 * into a region read off an attribute it does not have, (0, 0, 0, 1): u is always 0, the texture's first column is
 * stretched over the whole surface, and the mesh shows as streaks. The test is made `#if HAS_UV_REGIONS`.
 *
 * **Their place.** loaders.gl hands an I3S tile's vertices as ECEF positions, some 6 400 km from the Earth's centre,
 * with a model matrix that turns them east, north and up and takes the Earth's radius back off. deck does that sum on
 * the GPU, in 32-bit floats, where a coordinate of millions of metres keeps about half a metre: every vertex lands up
 * to a metre astray. A building's walls survive it; an integrated mesh, a drone's surface of triangles a few
 * decimetres across, is torn into slivers and its texture smeared into streaks (and under a base map that draws deck
 * interleaved, the error is worse). So each tile's vertices are worked out once, as it loads, in 64-bit floats on the
 * CPU, into metres east, north and up of the tile's own origin, and the model matrix becomes the identity: what deck
 * draws is the same mesh, within a millimetre.
 */

/** The call deck.gl's MeshLayer makes, and what it should be. */
export const ZERO_VERTEX_COLOUR = 'pbr_filterColor(vec4(0))';
export const WHITE_VERTEX_COLOUR = 'pbr_filterColor(vec4(1.0))';

/** The vertex shader's test for texture regions, and what it should be. */
export const UV_REGIONS_IFDEF = '#ifdef HAS_UV_REGIONS';
export const UV_REGIONS_IF = '#if HAS_UV_REGIONS';

/** Shaders as deck's `getShaders` returns them. */
export interface ShadersLike {
  vs?: string;
  fs?: string;
  [key: string]: unknown;
}

/** The shaders with the fragment shader's vertex colour white and the vertex shader's region test mended; the same
 * object when there is nothing to mend. */
export function mendShaders<S extends ShadersLike>(shaders: S): S {
  const { vs, fs } = shaders ?? ({} as S);
  const mendFs = typeof fs === 'string' && fs.includes(ZERO_VERTEX_COLOUR);
  const mendVs = typeof vs === 'string' && vs.includes(UV_REGIONS_IFDEF);
  if (!mendFs && !mendVs) {
    return shaders;
  }
  return {
    ...shaders,
    ...(mendFs ? { fs: fs!.split(ZERO_VERTEX_COLOUR).join(WHITE_VERTEX_COLOUR) } : {}),
    ...(mendVs ? { vs: vs!.split(UV_REGIONS_IFDEF).join(UV_REGIONS_IF) } : {}),
  };
}

interface MeshLayerLike {
  props?: Record<string, unknown>;
  constructor: Function;
  getShaders?: () => ShadersLike;
}

type LayerClass = new (props: Record<string, unknown>) => MeshLayerLike;

/** One mended subclass per class deck built. */
const mended = new WeakMap<Function, LayerClass>();

/** Whether a sublayer is deck's MeshLayer for an I3S tile: it takes a PBR material, unlike every other mesh layer. */
export function isPbrMeshLayer(layer: unknown): layer is MeshLayerLike {
  const candidate = layer as MeshLayerLike | null;
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.getShaders === 'function' &&
    candidate.props &&
    'pbrMaterial' in candidate.props
  );
}

/** The class of a mesh layer, its fragment shader mended; made once for each class. */
export function mendedClassOf(Base: Function): LayerClass {
  let Mended = mended.get(Base);
  if (!Mended) {
    const Parent = Base as LayerClass;
    Mended = class extends (Parent as any) {
      static layerName = (Base as { layerName?: string }).layerName;
      getShaders(): ShadersLike {
        return mendShaders(super.getShaders());
      }
    } as unknown as LayerClass;
    mended.set(Base, Mended);
    mended.set(Mended, Mended);
  }
  return Mended;
}

/**
 * The sublayer deck built for a tile, drawn with the mended shader when it is an I3S tile's mesh layer; any other
 * layer, or an array of them (a splat tile's), as it came.
 */
export function mendI3sMeshLayer<T>(layer: T): T {
  if (!isPbrMeshLayer(layer)) {
    return layer;
  }
  const Mended = mendedClassOf(layer.constructor);
  if (layer.constructor === Mended) {
    return layer;
  }
  return new Mended(layer.props as Record<string, unknown>) as unknown as T;
}

/** What this module reads and writes of an I3S tile. */
export interface I3sTileLike {
  tileset?: { type?: string } | null;
  content?: {
    attributes?: {
      positions?: { value?: ArrayLike<number>; [key: string]: unknown };
      normals?: { value?: ArrayLike<number>; [key: string]: unknown };
    };
    modelMatrix?: ArrayLike<number> | null;
    cartographicModelMatrix?: ArrayLike<number> | null;
  } | null;
}

/** Whether a tile is of an I3S scene layer (loaders.gl's tileset type). */
export function isI3sTile(tile: I3sTileLike | null | undefined): boolean {
  return tile?.tileset?.type === 'I3S';
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function isIdentityMatrix(m: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) {
    if (m[i] !== IDENTITY[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Bakes an I3S tile's model matrix into its vertices, in 64-bit floats: positions moved and turned, normals turned,
 * then the matrix left as the identity. True when it did; a tile already baked, or with nothing to bake, is left.
 */
export function bakeI3sPositions(tile: I3sTileLike | null | undefined): boolean {
  const content = tile?.content;
  const positions = content?.attributes?.positions;
  const m = content?.modelMatrix;
  const value = positions?.value;
  if (!content || !positions || !value || !m || m.length < 16 || isIdentityMatrix(m)) {
    return false;
  }
  const count = Math.floor(value.length / 3);
  const baked = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = value[i * 3];
    const y = value[i * 3 + 1];
    const z = value[i * 3 + 2];
    baked[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    baked[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    baked[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  content.attributes!.positions = { ...positions, value: baked };
  const normals = content.attributes!.normals;
  const n = normals?.value;
  if (normals && n && n.length >= count * 3) {
    const turned = new Float32Array(n.length);
    for (let i = 0; i < n.length / 3; i++) {
      const x = n[i * 3];
      const y = n[i * 3 + 1];
      const z = n[i * 3 + 2];
      turned[i * 3] = m[0] * x + m[4] * y + m[8] * z;
      turned[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z;
      turned[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z;
    }
    content.attributes!.normals = { ...normals, value: turned };
  }
  content.modelMatrix = IDENTITY.slice();
  content.cartographicModelMatrix = IDENTITY.slice();
  return true;
}
