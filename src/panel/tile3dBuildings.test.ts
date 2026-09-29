import { Ellipsoid } from '@math.gl/geospatial';
import { Matrix4, Vector3 } from '@math.gl/core';

import { fitToDeck, shiftContent, upAt } from './tile3dAltitude';
import { flattenBuildings, hasBuildings, liftOf, restoreBuildings, setVolumesFlat } from './tile3dBuildings';
import { regionBox } from './tile3dLoader';

/** Parque Calderón, Cuenca, where the city stands at about 2 550 m. */
const CUENCA = { longitude: -79.0045, latitude: -2.8975 };

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** WGS 84, geodetic (radians, metres) to ECEF. */
function ecef(longitude: number, latitude: number, height: number): number[] {
  const n = 6378137 / Math.sqrt(1 - 6.69437999014e-3 * Math.sin(latitude) ** 2);
  return [
    (n + height) * Math.cos(latitude) * Math.cos(longitude),
    (n + height) * Math.cos(latitude) * Math.sin(longitude),
    (n * (1 - 6.69437999014e-3) + height) * Math.sin(latitude),
  ];
}

/** Metres per degree of latitude near the equator, and of longitude on it: near enough to lay out a city. */
const METRES_PER_DEGREE_NORTH = 110_576;
const METRES_PER_DEGREE_EAST = 111_320;

/** A building as a box: how far east and north of Parque Calderón, its base's real altitude and its height. */
interface Building {
  east: number;
  north: number;
  base: number;
  height: number;
}

/**
 * Two buildings the way Cesium OSM Buildings keeps them: one in the centre,
 * 2 490 m up, and one on a hill 2 700 m up, 28 km from the origin deck draws
 * the tile round — far enough that the ground curves ~60 m below the tile's
 * tangent plane there.
 */
const CENTRE: Building = { east: 0, north: 0, base: 2490, height: 20 };
const HILL: Building = { east: 20_000, north: 20_000, base: 2700, height: 30 };

/** A box's eight corners in ECEF, ten metres across. */
function cornersOf(building: Building): number[][] {
  const corners: number[][] = [];
  for (const up of [0, building.height]) {
    for (const east of [-5, 5]) {
      for (const north of [-5, 5]) {
        const latitude = CUENCA.latitude + (building.north + north) / METRES_PER_DEGREE_NORTH;
        const longitude =
          CUENCA.longitude + (building.east + east) / (METRES_PER_DEGREE_EAST * Math.cos(radians(CUENCA.latitude)));
        corners.push(ecef(radians(longitude), radians(latitude), building.base + up));
      }
    }
  }
  return corners;
}

type Accessor = Record<string, any>;

/**
 * A loaded b3dm over Cuenca, as loaders.gl and the layer hand it to deck: its
 * glTF post-processed, Y up and centred on `RTC_CENTER` 2 600 m up, its
 * matrices worked out (`calculateTransformProps`) and in deck's metres
 * (`fitToDeck`). One primitive, one vertex per corner, each tagged with its
 * building's batch id.
 */
function batchedContent(
  buildings: Building[],
  options: { batchLength?: number; idName?: string; type?: string; quantized?: boolean; inBuffer?: boolean } = {}
) {
  const centre = ecef(radians(CUENCA.longitude), radians(CUENCA.latitude), 2600);
  const cartesian = new Matrix4().translate(centre).rotateX(Math.PI / 2);
  const toGltf = cartesian.clone().invert();
  const positions: number[] = [];
  const ids: number[] = [];
  buildings.forEach((building, id) =>
    cornersOf(building).forEach((corner) => {
      positions.push(...toGltf.transform(corner));
      ids.push(id);
    })
  );

  let POSITION: Accessor = {
    value: new Float32Array(positions),
    components: 3,
    componentType: 5126,
    count: positions.length / 3,
  };
  const node: Record<string, any> = {};
  if (options.quantized) {
    // KHR_mesh_quantization: normalized shorts, and the node's scale and translation to bring them back.
    const low = [0, 1, 2].map((axis) => Math.min(...positions.filter((_, i) => i % 3 === axis)));
    const high = [0, 1, 2].map((axis) => Math.max(...positions.filter((_, i) => i % 3 === axis)));
    const middle = low.map((value, axis) => (value + high[axis]) / 2);
    const half = low.map((value, axis) => (high[axis] - value) / 2 || 1);
    node.translation = middle;
    node.scale = half;
    POSITION = {
      value: new Int16Array(positions.map((value, i) => Math.round(((value - middle[i % 3]) / half[i % 3]) * 32767))),
      components: 3,
      componentType: 5122,
      normalized: true,
      count: positions.length / 3,
    };
  }
  if (options.inBuffer) {
    // As loaders.gl leaves it: the values copied out of the glb's binary, which the buffer view keeps.
    const arrayBuffer = new ArrayBuffer(16 + positions.length * 4);
    new Float32Array(arrayBuffer, 16).set(positions);
    POSITION.bufferView = { byteOffset: 8, buffer: { arrayBuffer, byteOffset: 8 } };
    POSITION.byteOffset = 0;
  }
  const attributes: Record<string, Accessor> = { POSITION };
  if (options.idName !== '') {
    attributes[options.idName ?? '_BATCHID'] = {
      value: new Float32Array(ids),
      components: 1,
      componentType: 5126,
      count: ids.length,
    };
  }
  node.mesh = { primitives: [{ attributes }] };
  const scene = { nodes: [node] };
  const gltf = { scenes: [scene], scene, nodes: [node], meshes: [node.mesh] };

  const cartesianOrigin = new Vector3(centre);
  const cartographicOrigin = Ellipsoid.WGS84.cartesianToCartographic(cartesianOrigin, new Vector3());
  const cartographicModelMatrix = Ellipsoid.WGS84.eastNorthUpToFixedFrame(cartesianOrigin)
    .invert()
    .multiplyRight(cartesian);
  const type = options.type ?? 'b3dm';
  const content: Record<string, any> = {
    type,
    gltf,
    cartesianOrigin,
    cartesianModelMatrix: cartesian,
    cartographicOrigin,
    cartographicModelMatrix,
    modelMatrix: cartographicModelMatrix,
  };
  if (type === 'b3dm') {
    content.featureTableJson = { BATCH_LENGTH: options.batchLength ?? buildings.length };
  }
  fitToDeck(content);
  return content;
}

/** A node's own matrix, from its matrix or its translation and scale (the tests use no rotation). */
function nodeMatrix(node: Record<string, any>): Matrix4 {
  if (node.matrix) {
    return new Matrix4(node.matrix);
  }
  return new Matrix4().translate(node.translation ?? [0, 0, 0]).scale(node.scale ?? [1, 1, 1]);
}

/**
 * How deck draws each building, per batch id: the lowest and highest drawn
 * height of its vertices, in metres above the map — the content's drawing
 * matrix times the node's, and the height of the origin deck draws round.
 */
function drawnHeights(content: Record<string, any>, only?: number): Map<number, { base: number; top: number }> {
  const heights = new Map<number, { base: number; top: number }>();
  const drawing = new Matrix4(content.modelMatrix);
  const visit = (node: Record<string, any>, parent: Matrix4) => {
    const world = parent.clone().multiplyRight(nodeMatrix(node));
    for (const primitive of node.mesh?.primitives ?? []) {
      const { POSITION, _BATCHID, _FEATURE_ID_0, BATCHID } = primitive.attributes;
      const ids = (_BATCHID ?? _FEATURE_ID_0 ?? BATCHID)?.value;
      const dequantize = (value: number) => (POSITION.normalized ? Math.max(value / 32767, -1) : value);
      const matrix = drawing.clone().multiplyRight(world);
      for (let i = 0; i < POSITION.value.length / 3; i++) {
        const p = [0, 1, 2].map((axis) => dequantize(POSITION.value[i * 3 + axis]));
        const z = matrix.transform(p)[2] + content.cartographicOrigin[2];
        const id = ids ? ids[i] : 0;
        const known = heights.get(id) ?? { base: Infinity, top: -Infinity };
        heights.set(id, { base: Math.min(known.base, z), top: Math.max(known.top, z) });
      }
    }
    for (const child of node.children ?? []) {
      visit(child, world);
    }
  };
  content.gltf.scenes[0].nodes.forEach(
    (node: Record<string, any>, k: number) => (only === undefined || only === k) && visit(node, new Matrix4())
  );
  return heights;
}

function positionsOf(content: Record<string, any>): Accessor {
  return content.gltf.scenes[0].nodes[0].mesh.primitives[0].attributes.POSITION;
}

describe('hasBuildings', () => {
  it('takes a b3dm of more than one feature, with batch ids, for buildings', () => {
    expect(hasBuildings(batchedContent([CENTRE, HILL]))).toBe(true);
  });

  it('takes a glTF whose feature ids name more than one feature for buildings', () => {
    expect(hasBuildings(batchedContent([CENTRE, HILL], { type: 'glTF', idName: '_FEATURE_ID_0' }))).toBe(true);
    expect(hasBuildings(batchedContent([CENTRE, HILL], { type: 'glTF', idName: 'BATCHID' }))).toBe(true);
    expect(hasBuildings(batchedContent([CENTRE], { type: 'glTF', idName: '_FEATURE_ID_0' }))).toBe(false);
  });

  it('does not take a mesh with no feature ids, like Google’s, for buildings', () => {
    expect(hasBuildings(batchedContent([CENTRE, HILL], { type: 'glTF', idName: '' }))).toBe(false);
  });

  it('does not take a b3dm of one feature or none, like a photogrammetry mesh, for buildings', () => {
    expect(hasBuildings(batchedContent([CENTRE, HILL], { batchLength: 1 }))).toBe(false);
    expect(hasBuildings(batchedContent([CENTRE, HILL], { batchLength: 0 }))).toBe(false);
  });

  it('does not take instanced models, point clouds or nothing at all for buildings', () => {
    expect(hasBuildings({ ...batchedContent([CENTRE, HILL]), type: 'i3dm', instances: [{}] })).toBe(false);
    expect(hasBuildings({ type: 'pnts', attributes: {} } as never)).toBe(false);
    expect(hasBuildings(null)).toBe(false);
  });
});

describe('flattenBuildings', () => {
  it('draws the lowest vertex of every building on the map, near its tile’s origin or far from it', () => {
    const content = batchedContent([CENTRE, HILL]);
    const before = drawnHeights(content);
    expect(before.get(0)!.base).toBeCloseTo(2490, 0);
    // 28 km from the origin: drawn ~60 m below its real 2 700 m, on the tangent plane.
    expect(before.get(1)!.base).toBeLessThan(2700 - 50);

    expect(flattenBuildings(content)).toBe(true);

    const after = drawnHeights(content);
    expect(after.get(0)!.base).toBeCloseTo(0, 1);
    expect(after.get(1)!.base).toBeCloseTo(0, 1);
    // Each keeps its height.
    [0, 1].forEach((id) =>
      expect(after.get(id)!.top - after.get(id)!.base).toBeCloseTo(before.get(id)!.top - before.get(id)!.base, 1)
    );
  });

  it('draws them where it is told: where the tileset has been moved to', () => {
    const content = batchedContent([CENTRE, HILL]);
    flattenBuildings(content, -2490);
    const after = drawnHeights(content);
    expect(after.get(0)!.base).toBeCloseTo(-2490, 1);
    expect(after.get(1)!.base).toBeCloseTo(-2490, 1);
  });

  it('moves the buildings as one afterwards: a Height adjustment of 20 m puts every base 20 m up', () => {
    const content = batchedContent([CENTRE, HILL]);
    flattenBuildings(content);
    shiftContent(
      content,
      upAt(CUENCA.longitude, CUENCA.latitude).map((v) => v * 20)
    );
    const after = drawnHeights(content);
    expect(after.get(0)!.base).toBeCloseTo(20, 1);
    expect(after.get(1)!.base).toBeCloseTo(20, 1);
  });

  it('prepares a content once: a second time changes nothing', () => {
    const content = batchedContent([CENTRE, HILL]);
    flattenBuildings(content);
    const flattened = positionsOf(content).value;
    const copy = Array.from(flattened);

    expect(flattenBuildings(content)).toBe(false);
    expect(positionsOf(content).value).toBe(flattened);
    expect(Array.from(positionsOf(content).value)).toEqual(copy);
  });

  it('hands deck a new glTF, which is how it knows to build the tile again', () => {
    const content = batchedContent([CENTRE, HILL]);
    const gltf = content.gltf;
    flattenBuildings(content);
    expect(content.gltf).not.toBe(gltf);
    expect(content.gltf.scenes).toBe(gltf.scenes);
  });

  it('turns quantized positions into floats before moving them', () => {
    const content = batchedContent([CENTRE, HILL], { quantized: true });
    const before = drawnHeights(content);

    expect(flattenBuildings(content)).toBe(true);

    const positions = positionsOf(content);
    expect(positions.value).toBeInstanceOf(Float32Array);
    expect(positions.normalized).toBe(false);
    expect(positions.componentType).toBe(5126);
    expect(positions.min).toHaveLength(3);
    expect(positions.max).toHaveLength(3);
    const after = drawnHeights(content);
    [0, 1].forEach((id) => {
      expect(after.get(id)!.base).toBeCloseTo(0, 1);
      expect(after.get(id)!.top - after.get(id)!.base).toBeCloseTo(before.get(id)!.top - before.get(id)!.base, 1);
    });
  });

  it('puts a content of one feature, or with no feature ids, on the map as one, once its tileset is buildings', () => {
    // hasBuildings tells the tileset apart; every content of it is then put on the map.
    const single = batchedContent([HILL], { batchLength: 1 });
    expect(flattenBuildings(single)).toBe(true);
    expect(drawnHeights(single).get(0)!.base).toBeCloseTo(0, 1);

    const unbatched = batchedContent([CENTRE, HILL], { type: 'glTF', idName: '' });
    expect(flattenBuildings(unbatched)).toBe(true);
    const [only] = [...drawnHeights(unbatched).values()];
    expect(only.base).toBeCloseTo(0, 1);
  });

  it('leaves alone instanced models and point clouds', () => {
    const instanced = { ...batchedContent([CENTRE, HILL]), type: 'i3dm', instances: [{}] };
    const positions = positionsOf(instanced).value;
    expect(flattenBuildings(instanced)).toBe(false);
    expect(positionsOf(instanced).value).toBe(positions);
    expect(flattenBuildings({ type: 'pnts', attributes: {} } as never)).toBe(false);
  });

  it('leaves a building far from the tile’s origin buried rather than misplaced', () => {
    // OSM Buildings' coarse tiles hold buildings 60 km from their centre and
    // more: there the tangent plane has left the ground, and one put on the map
    // stood tilted and far off.
    const near: Building = { east: 7_000, north: 7_000, base: 2600, height: 20 };
    const far: Building = { east: 70_000, north: 70_000, base: 2600, height: 20 };
    const content = batchedContent([near, far]);
    const before = drawnHeights(content);

    expect(flattenBuildings(content)).toBe(true);

    const after = drawnHeights(content);
    expect(after.get(0)!.base).toBeCloseTo(0, 1);
    expect(after.get(1)!.base).toBe(before.get(1)!.base);
    expect(after.get(1)!.top).toBe(before.get(1)!.top);
  });

  it('gives positions drawn by two nodes with different matrices a copy for each, and moves each by its own', () => {
    const content = batchedContent([CENTRE, HILL]);
    const [first] = content.gltf.nodes;
    const second = { mesh: first.mesh, translation: [300, 40, -200] };
    content.gltf.nodes.push(second);
    content.gltf.scenes[0].nodes.push(second);
    content.gltf.meshes = [first.mesh];
    const loaded = positionsOf(content).value;

    expect(flattenBuildings(content)).toBe(true);

    for (const node of [0, 1]) {
      const heights = drawnHeights(content, node);
      expect(heights.get(0)!.base).toBeCloseTo(0, 1);
      expect(heights.get(1)!.base).toBeCloseTo(0, 1);
    }
    expect(second.mesh).not.toBe(first.mesh);
    // luma.gl finds a node's mesh by id among the glTF's meshes.
    expect(content.gltf.meshes).toContain(second.mesh);
    expect(second.mesh.id).not.toBe(first.mesh.id);

    restoreBuildings(content);
    for (const node of [first, second]) {
      expect(Array.from(node.mesh.primitives[0].attributes.POSITION.value)).toEqual(Array.from(loaded));
    }
  });
});

describe('restoreBuildings', () => {
  it('puts back the geometry exactly as it loaded', () => {
    for (const quantized of [false, true]) {
      const content = batchedContent([CENTRE, HILL], { quantized });
      const original = { ...positionsOf(content) };
      const values = Array.from(original.value as ArrayLike<number>);
      flattenBuildings(content);
      const flattenedGltf = content.gltf;

      expect(restoreBuildings(content)).toBe(true);

      const restored = positionsOf(content);
      expect(restored.value).toBe(original.value);
      expect(Array.from(restored.value)).toEqual(values);
      expect(restored).toEqual(original);
      expect(content.gltf).not.toBe(flattenedGltf);
      expect(restoreBuildings(content)).toBe(false);
    }
  });

  it('reads the positions again from the buffer view rather than keeping a copy, when it holds them', () => {
    const content = batchedContent([CENTRE, HILL], { inBuffer: true });
    const loaded = positionsOf(content).value;
    const values = Array.from(loaded as ArrayLike<number>);
    flattenBuildings(content);

    restoreBuildings(content);

    const restored = positionsOf(content).value;
    expect(restored).not.toBe(loaded);
    expect(restored).toBeInstanceOf(Float32Array);
    expect(Array.from(restored)).toEqual(values);
  });

  it('keeps a copy when the buffer view does not hold what was loaded, as for a sparse accessor', () => {
    const content = batchedContent([CENTRE, HILL], { inBuffer: true });
    const loaded = positionsOf(content).value as Float32Array;
    loaded[0] += 1;
    flattenBuildings(content);
    restoreBuildings(content);
    expect(positionsOf(content).value).toBe(loaded);
  });

  it('can flatten them again after', () => {
    const content = batchedContent([CENTRE, HILL]);
    flattenBuildings(content);
    restoreBuildings(content);
    expect(flattenBuildings(content)).toBe(true);
    expect(drawnHeights(content).get(1)!.base).toBeCloseTo(0, 1);
  });
});

describe('liftOf', () => {
  it('says how far the tileset’s move has lifted a content’s origin', () => {
    const content = batchedContent([CENTRE, HILL]);
    const down = upAt(CUENCA.longitude, CUENCA.latitude).map((v) => v * -2490);
    shiftContent(content, down);
    const model = new Matrix4().translate(down);
    expect(liftOf(content, model)).toBeCloseTo(-2490, 3);
    expect(liftOf(content, new Matrix4())).toBe(0);
    expect(liftOf(null, model)).toBe(0);
  });
});

describe('setVolumesFlat', () => {
  /** A few blocks of Cuenca as ion's tiler writes them, boxed the way `tile3dLoader.ts` does. */
  const REGION = [
    radians(CUENCA.longitude - 0.02),
    radians(CUENCA.latitude - 0.02),
    radians(CUENCA.longitude + 0.02),
    radians(CUENCA.latitude + 0.02),
    2490,
    2730,
  ];

  function regionTile() {
    const header = { boundingVolume: { region: REGION, box: regionBox(REGION) } };
    return { header, _updateBoundingVolume: jest.fn() };
  }

  it('culls a region’s tile where its flattened buildings are drawn, from the map up, and back again', () => {
    const tile = regionTile();
    const real = tile.header.boundingVolume.box;

    setVolumesFlat([tile], true);
    expect(tile.header.boundingVolume.box).toEqual(regionBox([...REGION.slice(0, 4), 0, 240]));
    expect(tile.header.boundingVolume.region).toBe(REGION);
    expect(tile._updateBoundingVolume).toHaveBeenLastCalledWith(tile.header);

    // Again: nothing to do.
    tile._updateBoundingVolume.mockClear();
    setVolumesFlat([tile], true);
    expect(tile._updateBoundingVolume).not.toHaveBeenCalled();

    setVolumesFlat([tile], false);
    expect(tile.header.boundingVolume.box).toBe(real);
    expect(tile._updateBoundingVolume).toHaveBeenLastCalledWith(tile.header);
  });

  it('builds again a tile made from a header another tree already flattened', () => {
    // Tileset3D builds one tree per viewport from the same headers.
    const first = regionTile();
    const second = { header: first.header, _updateBoundingVolume: jest.fn() };
    setVolumesFlat([first], true);
    setVolumesFlat([second], true);
    expect(second._updateBoundingVolume).toHaveBeenCalledWith(first.header);
  });

  it('lowers an ECEF box so that what it held is held from the map up', () => {
    const lon = radians(CUENCA.longitude);
    const lat = radians(CUENCA.latitude);
    const east = [-Math.sin(lon), Math.cos(lon), 0];
    const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
    const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const box = [
      ...ecef(lon, lat, 2600),
      ...east.map((v) => v * 1000),
      ...north.map((v) => v * 1000),
      ...up.map((v) => v * 100),
    ];
    const tile = { header: { boundingVolume: { box } }, _updateBoundingVolume: jest.fn() };

    setVolumesFlat([tile], true);
    const flat = tile.header.boundingVolume.box;
    expect(flat).not.toBe(box);

    // Every point the box held, 2 500 to 2 700 m up, is held again 0 to 200 m up.
    const inside = (point: number[]) =>
      [0, 1, 2].every((axis) => {
        const half = flat.slice(3 + axis * 3, 6 + axis * 3);
        const length2 = half[0] ** 2 + half[1] ** 2 + half[2] ** 2;
        const along = [0, 1, 2].reduce((sum, k) => sum + (point[k] - flat[k]) * half[k], 0) / length2;
        return Math.abs(along) <= 1;
      });
    for (const e of [-990, 0, 990]) {
      for (const n of [-990, 0, 990]) {
        for (const h of [0, 100, 199]) {
          const latitude = CUENCA.latitude + n / METRES_PER_DEGREE_NORTH;
          const longitude = CUENCA.longitude + e / (METRES_PER_DEGREE_EAST * Math.cos(lat));
          expect(inside(ecef(radians(longitude), radians(latitude), h))).toBe(true);
        }
      }
    }
    setVolumesFlat([tile], false);
    expect(tile.header.boundingVolume.box).toBe(box);
  });

  it('leaves alone a tile under a transform of its own, and a box round the whole Earth', () => {
    const transformed = { ...regionTile(), transform: new Matrix4().translate([1, 2, 3]) };
    const real = transformed.header.boundingVolume.box;
    const earth = { header: { boundingVolume: { box: [0, 0, 0, 7645212, 0, 0, 0, 7645212, 0, 0, 0, 7645212] } } };
    const earthBox = earth.header.boundingVolume.box;
    const child = { ...regionTile(), parent: transformed };
    const childBox = child.header.boundingVolume.box;

    setVolumesFlat([transformed, earth, child], true);

    expect(transformed.header.boundingVolume.box).toBe(real);
    expect(earth.header.boundingVolume.box).toBe(earthBox);
    expect(child.header.boundingVolume.box).toBe(childBox);
    expect(transformed._updateBoundingVolume).not.toHaveBeenCalled();
  });
});
