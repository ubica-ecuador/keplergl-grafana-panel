import { Ellipsoid } from '@math.gl/geospatial';
import { Matrix4, Vector3 } from '@math.gl/core';

import { fitToDeck, shiftContent } from './tile3dAltitude';
import { TILE3D_ALTITUDE_VIS_CONFIGS, altitudeAware, withTile3dAltitude } from './tile3dAltitudeLayer';
import { sturdyLoader } from './tile3dLoader';

/** math.gl's `Matrix4` as far as this code cares: an array with a `clone`. */
class FakeMatrix extends Array<number> {
  static identity(): FakeMatrix {
    const m = new FakeMatrix();
    m.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    return m;
  }

  clone(): FakeMatrix {
    const m = new FakeMatrix();
    m.push(...this);
    return m;
  }
}

/** A loaded tileset whose base sits 300 m above the map's ground plane. */
function tileset() {
  return {
    modelMatrix: FakeMatrix.identity(),
    cartographicCenter: [-75.6, 40, 300],
    root: { transform: null, header: { boundingVolume: {} } },
  };
}

/** Cesium OSM Buildings as far as its tree is known over Cuenca: the world, the west, and a few blocks at 2 490 m. */
function osmBuildingsOverCuenca(isLoaded = true) {
  const blocks = {
    header: { boundingVolume: { region: [-1.37916, -0.05066, -1.37846, -0.05036, 2490, 2610] } },
    children: [],
  };
  const west = { header: { boundingVolume: { region: [-Math.PI, -1.47, 0, 1.45, -394, 5967] } }, children: [blocks] };
  const world = { region: [-3.14159, -1.4712, 3.14154, 1.4503, -394, 5967] };
  return {
    modelMatrix: FakeMatrix.identity(),
    cartographicCenter: [0, 0, 0],
    // As Tileset3D keeps them: `root` as built, and the tree it traverses for the view, grown as tiles load.
    root: { header: { boundingVolume: world }, children: [] },
    roots: { 'kepler-map': { header: { boundingVolume: world }, children: [west] } },
    isLoaded: () => isLoaded,
  };
}

/**
 * Cesium OSM Buildings before its western hemisphere has loaded: over Quito, or
 * anywhere, only the world and a nested tileset still to come are known.
 */
function osmBuildingsBeforeWest(isLoaded: () => boolean = () => true) {
  const world = { region: [-3.14159, -1.4712, 3.14154, 1.4503, -394, 5967] };
  const west = {
    header: { boundingVolume: { region: [-Math.PI, -1.47, 0, 1.45, -394, 5967] }, contentUrl: 'west.json' },
    children: [],
  };
  return {
    modelMatrix: FakeMatrix.identity(),
    cartographicCenter: [0, 0, 0],
    root: { header: { boundingVolume: world }, children: [] },
    roots: { 'kepler-map': { header: { boundingVolume: world }, children: [west] } } as Record<string, unknown>,
    isLoaded,
  };
}

/** deck's viewport over a point, with the camera this many metres above the ground plane. */
function viewportOver(longitude: number, latitude: number, cameraHeight: number) {
  // deck keeps the camera in its own units; three of them to the metre here, as a real one would not be one.
  return {
    id: 'kepler-map',
    longitude,
    latitude,
    cameraPosition: [0, 0, cameraHeight * 3],
    distanceScales: { unitsPerMeter: [3, 3, 3] },
  };
}

/** The ellipsoid's normal at a longitude and latitude in degrees. */
function upOver(longitude: number, latitude: number): number[] {
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Stands in for deck's `Tile3DLayer`: the members the subclass touches. */
class FakeDeckLayer {
  static layerName = 'KeplerTile3DLayer';
  static defaultProps = { data: null, opacity: 1 };

  props: Record<string, unknown>;
  context: Record<string, unknown> = {};
  state: Record<string, unknown> = { activeViewports: {}, lastUpdatedViewports: null };
  superCalls = 0;
  traversals: unknown[] = [];
  loadedTiles: unknown[] = [];
  updatesAsked = 0;
  finalized = 0;

  constructor(props: Record<string, unknown>) {
    this.props = props;
  }

  updateState(_params: unknown): void {
    this.superCalls += 1;
  }

  _updateTileset(viewports: unknown): void {
    this.traversals.push(viewports);
  }

  _onTileLoad(tile: unknown): void {
    this.loadedTiles.push(tile);
  }

  setNeedsUpdate(): void {
    this.updatesAsked += 1;
  }

  finalizeState(_context: unknown): void {
    this.finalized += 1;
  }
}

/** Stands in for kepler's `Tile3DLayer`: the layer class the mixin wraps. */
function fakeKeplerLayer(built: unknown[]) {
  return class FakeKeplerLayer {
    config: { visConfig: Record<string, unknown> } = { visConfig: {} };
    visConfigSettings: Record<string, unknown> = { opacity: { type: 'number' } };
    _hasFittedBounds = false;
    /** What kepler's own handler found the flag at: it frames the map only while it is false. */
    fittedWhenLoaded: boolean[] = [];
    // kepler defines its handler as an arrow in its constructor, as this does.
    _onTilesetLoad = (_tileset: unknown) => {
      this.fittedWhenLoaded.push(this._hasFittedBounds);
    };

    registerVisConfig(configs: Record<string, unknown>): void {
      Object.assign(this.visConfigSettings, configs);
    }

    renderLayer(): unknown[] {
      return built;
    }
  };
}

describe('withTile3dAltitude', () => {
  it('adds the two knobs without disturbing the ones kepler registered', () => {
    const Wrapped = withTile3dAltitude(fakeKeplerLayer([]) as never) as never as new () => {
      visConfigSettings: Record<string, unknown>;
    };
    const layer = new Wrapped();

    expect(layer.visConfigSettings.opacity).toBeDefined();
    expect(layer.visConfigSettings.groundTileset).toEqual(TILE3D_ALTITUDE_VIS_CONFIGS.groundTileset);
    expect(layer.visConfigSettings.altitudeOffset).toEqual(TILE3D_ALTITUDE_VIS_CONFIGS.altitudeOffset);
  });

  it('rebuilds the deck layer as the altitude-aware class, keeping its props', () => {
    const built = new FakeDeckLayer({ id: 'malla', data: 'https://example.test/tileset.json', opacity: 0.5 });
    const Wrapped = withTile3dAltitude(fakeKeplerLayer([built]) as never) as never as new () => {
      config: { visConfig: Record<string, unknown> };
      renderLayer(): Array<{ props: Record<string, unknown> }>;
    };

    const layer = new Wrapped();
    layer.config.visConfig = { groundTileset: false, altitudeOffset: -300 };
    const [rebuilt] = layer.renderLayer();

    expect(rebuilt).toBeInstanceOf(altitudeAware(FakeDeckLayer as never));
    expect(rebuilt.props.id).toBe('malla');
    expect(rebuilt.props.opacity).toBe(0.5);
    // The knobs travel as deck props so the subclass can resolve them against
    // the tileset, which only exists inside the deck layer.
    expect(rebuilt.props.groundTileset).toBe(false);
    expect(rebuilt.props.altitudeOffset).toBe(-300);
  });

  it('grounds by default, so a mesh added through Add Data is visible at once', () => {
    const built = new FakeDeckLayer({ id: 'malla' });
    const Wrapped = withTile3dAltitude(fakeKeplerLayer([built]) as never) as never as new () => {
      renderLayer(): Array<{ props: Record<string, unknown> }>;
    };

    const [rebuilt] = new Wrapped().renderLayer();
    expect(rebuilt.props.groundTileset).toBe(true);
    expect(rebuilt.props.altitudeOffset).toBe(0);
  });

  it('hands deck the mended loader, the same one on every render', () => {
    const tiles3d = { id: '3d-tiles', parse: async () => ({}) };
    const built = new FakeDeckLayer({ id: 'malla', loader: tiles3d });
    const Wrapped = withTile3dAltitude(fakeKeplerLayer([built]) as never) as never as new () => {
      renderLayer(): Array<{ props: Record<string, unknown> }>;
    };
    const layer = new Wrapped();

    const [first] = layer.renderLayer();
    const [second] = layer.renderLayer();
    expect(first.props.loader).toBe(sturdyLoader(tiles3d));
    expect(second.props.loader).toBe(first.props.loader);
  });

  it('does not frame the map round a tileset that spans the whole world', () => {
    // kepler frames the map round every tileset it loads but Google's: Cesium
    // OSM Buildings threw a map of Cuenca out to the whole planet.
    const Wrapped = withTile3dAltitude(fakeKeplerLayer([]) as never) as never as new () => {
      _onTilesetLoad(tileset: unknown): void;
      fittedWhenLoaded: boolean[];
    };
    const world = new Wrapped();
    world._onTilesetLoad({ root: { header: { boundingVolume: { region: [-3.14, -1.47, 3.14, 1.45, -394, 5967] } } } });
    expect(world.fittedWhenLoaded).toEqual([true]);

    const building = new Wrapped();
    building._onTilesetLoad(tileset());
    expect(building.fittedWhenLoaded).toEqual([false]);
  });

  it('leaves alone anything that is not a deck layer', () => {
    const Wrapped = withTile3dAltitude(fakeKeplerLayer([null, undefined, {}]) as never) as never as new () => {
      renderLayer(): unknown[];
    };
    expect(new Wrapped().renderLayer()).toEqual([null, undefined, {}]);
  });
});

describe('altitudeAware', () => {
  it('hands back the same subclass for the same base', () => {
    // A fresh class on every render would make deck treat the layer as a new
    // one: it would tear the tileset down and download it again, every frame.
    expect(altitudeAware(FakeDeckLayer as never)).toBe(altitudeAware(FakeDeckLayer as never));
  });

  it('moves the tileset and asks for a fresh traversal', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const ts = tileset();
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null };

    layer.updateState({});

    expect(layer.superCalls).toBe(1);
    expect(ts.modelMatrix[14]).toBeCloseTo(-300, 9);
    // The bounding volumes the last traversal culled against have all moved,
    // so waiting for the user to nudge the camera would leave the map blank.
    expect(layer.traversals).toEqual([{ main: 'vp' }]);
  });

  it('falls back to the viewports of the last traversal', () => {
    // deck empties `activeViewports` as soon as it has traversed with them, so
    // by the time a knob moves they are usually gone.
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true });
    layer.state = { tileset3d: tileset(), activeViewports: {}, lastUpdatedViewports: { main: 'antes' } };

    layer.updateState({});
    expect(layer.traversals).toEqual([{ main: 'antes' }]);
  });

  it('does not traverse again once the tileset is already where it belongs', () => {
    // `_updateTileset` ends in `setState`, which brings `updateState` round
    // again: without this guard the layer would traverse for ever.
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true });
    layer.state = { tileset3d: tileset(), activeViewports: { main: 'vp' }, lastUpdatedViewports: null };

    layer.updateState({});
    layer.updateState({});
    layer.updateState({});

    expect(layer.superCalls).toBe(3);
    expect(layer.traversals).toHaveLength(1);
  });

  it('lowers a tileset round the whole world by the ground under the centre of the view', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const ts = osmBuildingsOverCuenca();
    layer.context = { viewport: viewportOver(-79.0, -2.894, 1700) };
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 1 };

    layer.updateState({});

    // Down by the 2 490 m of the blocks under the centre, along the vertical there.
    upOver(-79.0, -2.894).forEach((value, axis) => expect(ts.modelMatrix[12 + axis]).toBeCloseTo(-2490 * value, 6));
    expect(layer.traversals).toEqual([{ main: 'vp' }]);
  });

  it('searches for the ground, one step per traversal, while the tree does not reach under the view', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const ts = osmBuildingsBeforeWest();
    // Quito: the tree knows nothing small there yet, and the west is still to load.
    layer.context = { viewport: viewportOver(-78.5, -0.2, 1700) };
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 1 };
    const up = upOver(-78.5, -0.2);

    layer.updateState({});
    expect(ts.modelMatrix[14]).toBeCloseTo(-1500 * up[2], 6);

    // Nothing has been traversed since: no second step yet.
    layer.updateState({});
    expect(ts.modelMatrix[14]).toBeCloseTo(-1500 * up[2], 6);
    expect(layer.traversals).toHaveLength(1);

    layer.state.frameNumber = 2;
    layer.updateState({});
    expect(ts.modelMatrix[14]).toBeCloseTo(-3000 * up[2], 6);
    expect(layer.traversals).toHaveLength(2);
  });

  it('only trims a tileset round the whole world when grounding is off, along the vertical at the centre', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: false, altitudeOffset: -100 });
    const ts = osmBuildingsOverCuenca();
    layer.context = { viewport: viewportOver(-79.0, -2.894, 1700) };
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 1 };

    layer.updateState({});
    upOver(-79.0, -2.894).forEach((value, axis) => expect(ts.modelMatrix[12 + axis]).toBeCloseTo(-100 * value, 6));
  });

  it('moves a tileset round the whole world for any change of the Height adjustment, however small', () => {
    // The tolerance is for the ground under the view, which moves with every
    // pan; the trim is what the user asked for.
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const ts = osmBuildingsOverCuenca();
    layer.context = { viewport: viewportOver(-79.0, -2.894, 1700) };
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 1 };
    layer.updateState({});

    layer.props = { groundTileset: true, altitudeOffset: 20 };
    layer.updateState({});
    const up = upOver(-79.0, -2.894);
    up.forEach((value, axis) => expect(ts.modelMatrix[12 + axis]).toBeCloseTo((20 - 2490) * value, 6));
    expect(layer.traversals).toHaveLength(2);
  });

  it('takes the next search step after enough traversals, or long enough, while tiles are still loading', () => {
    // Under throttling something is always loading, and `isLoaded` never comes true.
    const now = jest.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
        props: Record<string, unknown>
      ) => FakeDeckLayer;
      const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
      const ts = osmBuildingsBeforeWest(() => false);
      layer.context = { viewport: viewportOver(-78.5, -0.2, 1700) };
      layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 1 };
      const up = upOver(-78.5, -0.2);

      layer.updateState({});
      expect(ts.modelMatrix[14]).toBe(0);

      layer.state.frameNumber = 20;
      layer.updateState({});
      expect(ts.modelMatrix[14]).toBeCloseTo(-1500 * up[2], 6);

      layer.state.frameNumber = 21;
      now.mockReturnValue(2_000);
      layer.updateState({});
      expect(ts.modelMatrix[14]).toBeCloseTo(-1500 * up[2], 6);

      now.mockReturnValue(3_000);
      layer.updateState({});
      expect(ts.modelMatrix[14]).toBeCloseTo(-3000 * up[2], 6);
    } finally {
      now.mockRestore();
    }
  });

  it('does not search where the tree for the view has not been built yet', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const ts = osmBuildingsBeforeWest();
    ts.roots = {};
    layer.context = { viewport: viewportOver(-78.5, -0.2, 1700) };
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 5 };

    layer.updateState({});
    expect(Array.from(ts.modelMatrix)).toEqual(Array.from(FakeMatrix.identity()));
    expect(layer.traversals).toHaveLength(0);
  });

  it('does not search a wide tileset bounded by a sphere, or under a transform: it stays where it is', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const sphere = osmBuildingsBeforeWest();
    sphere.root = { header: { boundingVolume: { sphere: [0, 0, 0, 7_000_000] } as never }, children: [] };
    const transformed = osmBuildingsBeforeWest();
    (transformed.root as Record<string, unknown>).transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1000, 0, 0, 1];

    for (const ts of [sphere, transformed]) {
      const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
      layer.context = { viewport: viewportOver(-78.5, -0.2, 1700) };
      layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 5 };
      layer.updateState({});
      layer.state.frameNumber = 6;
      layer.updateState({});
      expect(Array.from(ts.modelMatrix)).toEqual(Array.from(FakeMatrix.identity()));
      expect(layer.traversals).toHaveLength(0);
    }
  });

  it('starts afresh when the tileset is replaced', () => {
    // A new tileset (a new URL, or the same one reloaded) is somewhere else
    // entirely: the old one's ground must not carry over to it.
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    layer.context = { viewport: viewportOver(-79.0, -2.894, 1700) };
    layer.state = {
      tileset3d: osmBuildingsOverCuenca(),
      activeViewports: { main: 'vp' },
      lastUpdatedViewports: null,
      frameNumber: 1,
    };
    layer.updateState({});
    expect(layer.traversals).toHaveLength(1);

    // Over the sea off Ecuador there is nothing under the view: the ground held is the new tileset's own, none.
    const replaced = osmBuildingsOverCuenca();
    layer.context = { viewport: viewportOver(-85, -2, 1700) };
    layer.state.tileset3d = replaced;
    layer.updateState({});
    expect(Array.from(replaced.modelMatrix)).toEqual(Array.from(FakeMatrix.identity()));
  });

  it('has deck draw again every tile it had drawn, once the tileset has moved', () => {
    // The tiles' drawing transforms have moved with the tileset, and deck only
    // rebuilds a tile's sublayer when told to.
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const layerMap = { a: { needsUpdate: false }, b: {} as { needsUpdate?: boolean } };
    layer.state = {
      tileset3d: tileset(),
      activeViewports: { main: 'vp' },
      lastUpdatedViewports: null,
      layerMap,
    };
    layer.updateState({});
    expect(layerMap.a.needsUpdate).toBe(true);
    expect(layerMap.b.needsUpdate).toBe(true);

    layerMap.a.needsUpdate = false;
    layer.updateState({});
    expect(layerMap.a.needsUpdate).toBe(false);
  });

  it('moves a tile that loaded against where the tileset was before handing it on', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer & { _onTileLoad(tile: unknown): void };
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const moved = FakeMatrix.identity();
    moved[14] = -300;
    const content = {
      cartesianOrigin: [6_378_137, 0, 0],
      cartesianModelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6_378_137, 0, 0, 1],
    };
    const tile = {
      tileset: { modelMatrix: moved },
      transform: FakeMatrix.identity(),
      computedTransform: FakeMatrix.identity(),
      content,
    };

    layer._onTileLoad(tile);
    expect(content.cartesianOrigin[2]).toBeCloseTo(-300, 9);
    expect(layer.loadedTiles).toEqual([tile]);
  });

  it('hands on a tile just loaded in the metres deck draws with, and has deck build it again', () => {
    // A tile 28 km across drawn in a sphere's metres is drawn ~140 m off near
    // the equator (tile3dDeckMetres.ts). A sublayer deck already built for the
    // tile, from before it loaded again, is built again with the new matrix.
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer & { _onTileLoad(tile: unknown): void };
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const layerMap: Record<string, { layer?: unknown; needsUpdate?: boolean }> = {
      far: { layer: { id: 'far-sublayer' }, needsUpdate: false },
    };
    layer.state = { ...layer.state, layerMap };
    // loaders.gl's numbers for a tile whose origin is on the equator at 0°: east is y, north is z, up is x.
    const cartographicModelMatrix = FakeMatrix.identity();
    cartographicModelMatrix[12] = 27_947;
    const content = {
      cartesianOrigin: [6_378_137, 0, 0],
      cartesianModelMatrix: [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 6_378_137, 27_947, 0, 1],
      cartographicOrigin: [0, 0, 0],
      cartographicModelMatrix,
      modelMatrix: cartographicModelMatrix as unknown,
    };
    const tile = {
      id: 'far',
      tileset: { modelMatrix: FakeMatrix.identity() },
      computedTransform: FakeMatrix.identity(),
      content,
    };

    layer._onTileLoad(tile);
    expect(content.modelMatrix).not.toBe(cartographicModelMatrix);
    expect(content.modelMatrix).toBe(content.cartographicModelMatrix);
    // 27 947 m east on the ground are ~27 915 of deck's.
    expect((content.modelMatrix as number[])[12]).toBeCloseTo((27_947 * 40.03e6) / (2 * Math.PI) / 6_378_137, 6);
    expect(layerMap.far.needsUpdate).toBe(true);
    expect(layer.loadedTiles).toEqual([tile]);

    // Loaded again with nothing new, nothing to build again.
    layerMap.far.needsUpdate = false;
    layer._onTileLoad(tile);
    expect(layerMap.far.needsUpdate).toBe(false);
  });

  it('leaves alone an entry deck keeps for a tile it has not built a sublayer for', () => {
    // After an unload deck keeps `{ tile }` for the tile, and builds its
    // sublayer when it next draws it: asking for it again would build it twice.
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer & { _onTileLoad(tile: unknown): void };
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const entry: { tile: unknown; needsUpdate?: boolean } = { tile: null };
    layer.state = { ...layer.state, layerMap: { far: entry } };
    const cartographicModelMatrix = FakeMatrix.identity();
    cartographicModelMatrix[12] = 27_947;
    const content = {
      cartesianOrigin: [6_378_137, 0, 0],
      cartesianModelMatrix: [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 6_378_137, 27_947, 0, 1],
      cartographicOrigin: [0, 0, 0],
      cartographicModelMatrix,
      modelMatrix: cartographicModelMatrix as unknown,
    };
    const tile = {
      id: 'far',
      tileset: { modelMatrix: FakeMatrix.identity() },
      computedTransform: FakeMatrix.identity(),
      content,
    };

    layer._onTileLoad(tile);
    expect(content.modelMatrix).not.toBe(cartographicModelMatrix);
    expect(entry.needsUpdate).toBeUndefined();
  });

  it('drops a searched ground over the sea once the tree says nothing is there', () => {
    // Before the western hemisphere loads, the sea off Ecuador lies under a
    // tile too big to tell, and the search lowers the tileset. Once it has
    // loaded there are no buildings there: holding the searched ground would
    // leave the coast's buildings that far underground.
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const ts = osmBuildingsBeforeWest();
    layer.context = { viewport: viewportOver(-85, -2, 1700) };
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 1 };
    const up = upOver(-85, -2);

    layer.updateState({});
    expect(ts.modelMatrix[14]).toBeCloseTo(-1500 * up[2], 6);

    // The west has loaded: its only buildings are Cuenca's.
    const loaded = osmBuildingsOverCuenca();
    ts.roots = loaded.roots;
    layer.state.frameNumber = 2;
    layer.updateState({});
    expect(ts.modelMatrix[14]).toBeCloseTo(0, 6);
    expect(layer.state.ground).toBe(0);
    // The search starts afresh from here, should the view find a tile too big to tell again.
    expect(layer.state.groundSearchFrame).toBe(2);
  });

  it('holds the last ground a tile told when the view moves out to sea', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
    const ts = osmBuildingsOverCuenca();
    layer.context = { viewport: viewportOver(-79.0, -2.894, 1700) };
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 1 };
    layer.updateState({});

    layer.context = { viewport: viewportOver(-85, -2, 1700) };
    layer.state.frameNumber = 2;
    layer.updateState({});
    const up = upOver(-85, -2);
    expect(ts.modelMatrix[14]).toBeCloseTo(-2490 * up[2], 6);
  });

  describe('once a search step has been taken', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /** A layer that has just taken one search step over Quito, with tiles still loading. */
    function searching() {
      const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
        props: Record<string, unknown>
      ) => FakeDeckLayer & { finalizeState(context: unknown): void };
      const layer = new Aware({ groundTileset: true, altitudeOffset: 0 });
      const ts = osmBuildingsBeforeWest(() => false);
      layer.context = { viewport: viewportOver(-78.5, -0.2, 1700) };
      layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 20 };
      layer.updateState({});
      expect(ts.modelMatrix[14]).not.toBe(0);
      return layer;
    }

    it('asks deck for an update when the step is due to settle, whether or not anything else happens', () => {
      // Nothing else may bring `updateState` round: a quiet map would wait for
      // the user to move it before the search took its next step.
      const layer = searching();
      jest.advanceTimersByTime(2_999);
      expect(layer.updatesAsked).toBe(0);
      jest.advanceTimersByTime(1);
      expect(layer.updatesAsked).toBe(1);
    });

    it('keeps one timer, not one per step', () => {
      const layer = searching();
      layer.state.frameNumber = 40;
      layer.updateState({});
      jest.advanceTimersByTime(10_000);
      expect(layer.updatesAsked).toBe(1);
    });

    it('does not ask once the layer is finalized, or its tileset replaced', () => {
      const finalized = searching();
      finalized.finalizeState({});
      expect(finalized.finalized).toBe(1);
      const replaced = searching();
      replaced.state.tileset3d = null;
      jest.advanceTimersByTime(10_000);
      expect(finalized.updatesAsked).toBe(0);
      expect(replaced.updatesAsked).toBe(0);
    });
  });

  it('survives an update before the tileset has loaded', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true });

    expect(() => layer.updateState({})).not.toThrow();
    expect(layer.traversals).toHaveLength(0);
  });
});

/** WGS 84, geodetic (degrees, metres) to ECEF. */
function ecefAt(longitude: number, latitude: number, height: number): number[] {
  const [lon, lat] = [(longitude * Math.PI) / 180, (latitude * Math.PI) / 180];
  const n = 6378137 / Math.sqrt(1 - 6.69437999014e-3 * Math.sin(lat) ** 2);
  return [
    (n + height) * Math.cos(lat) * Math.cos(lon),
    (n + height) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - 6.69437999014e-3) + height) * Math.sin(lat),
  ];
}

/** Two buildings of central Cuenca, as batch ids 0 and 1: one 2 490 m up, one on a rise 2 700 m up, 400 m away. */
const BUILDINGS = [
  { longitude: -79.0045, latitude: -2.8975, base: 2490, height: 20 },
  { longitude: -79.002, latitude: -2.895, base: 2700, height: 30 },
];

/**
 * A b3dm of those two buildings as loaders.gl hands it over once loaded:
 * post-processed glTF, Y up round `RTC_CENTER`, its matrices worked out and
 * in deck's metres — at their real altitude, or already moved by `delta`
 * (ECEF) when it loaded under a tileset that had been moved. With no
 * `_BATCHID`, the same mesh the way Google's tiles come.
 */
function buildingsContent(delta: ArrayLike<number> = [0, 0, 0], batched = true) {
  const centre = ecefAt(-79.0045, -2.8975, 2600);
  const cartesian = new Matrix4().translate(centre).rotateX(Math.PI / 2);
  const toGltf = cartesian.clone().invert();
  const positions: number[] = [];
  const ids: number[] = [];
  BUILDINGS.forEach(({ longitude, latitude, base, height }, id) => {
    for (const up of [0, height]) {
      for (const [east, north] of [
        [0, 0],
        [0.0001, 0],
        [0, 0.0001],
      ]) {
        positions.push(...toGltf.transform(ecefAt(longitude + east, latitude + north, base + up)));
        ids.push(id);
      }
    }
  });
  const attributes: Record<string, unknown> = {
    POSITION: { value: new Float32Array(positions), components: 3, componentType: 5126 },
    ...(batched ? { _BATCHID: { value: new Float32Array(ids), components: 1, componentType: 5126 } } : {}),
  };
  const node = { mesh: { primitives: [{ attributes }] } };
  const cartesianOrigin = new Vector3(centre);
  const cartographicModelMatrix = Ellipsoid.WGS84.eastNorthUpToFixedFrame(cartesianOrigin)
    .invert()
    .multiplyRight(cartesian);
  const content = {
    type: batched ? 'b3dm' : 'glTF',
    ...(batched ? { featureTableJson: { BATCH_LENGTH: 2 } } : {}),
    gltf: { scenes: [{ nodes: [node] }], nodes: [node] } as Record<string, any>,
    cartesianOrigin,
    cartesianModelMatrix: cartesian,
    cartographicOrigin: Ellipsoid.WGS84.cartesianToCartographic(cartesianOrigin, new Vector3()),
    cartographicModelMatrix,
    modelMatrix: cartographicModelMatrix,
  };
  fitToDeck(content);
  shiftContent(content, delta);
  return content;
}

/** The lowest height deck draws each building at, by batch id, in metres above the map. */
function drawnBases(content: ReturnType<typeof buildingsContent>): number[] {
  const { POSITION } = content.gltf.scenes[0].nodes[0].mesh.primitives[0].attributes;
  const matrix = new Matrix4(Array.from(content.modelMatrix as ArrayLike<number>));
  const bases = [Infinity, Infinity];
  for (let i = 0; i < POSITION.value.length / 3; i++) {
    const z = matrix.transform(Array.from(POSITION.value.slice(i * 3, i * 3 + 3)))[2] + content.cartographicOrigin[2];
    const id = i < POSITION.value.length / 6 ? 0 : 1;
    bases[id] = Math.min(bases[id], z);
  }
  return bases;
}

describe('altitudeAware, with a tileset of batched buildings', () => {
  type BuildingsLayer = FakeDeckLayer & { _onTileLoad(tile: unknown): void };
  const Aware = () =>
    altitudeAware(FakeDeckLayer as never) as never as new (props: Record<string, unknown>) => BuildingsLayer;

  /**
   * OSM Buildings over Cuenca, lowered by the ground under the view as any
   * tileset round the world is, and a tile of two buildings loaded under it.
   */
  function loadedOverCuenca(batched = true) {
    const layer = new (Aware())({ groundTileset: true, altitudeOffset: 0 });
    const ts = osmBuildingsOverCuenca() as ReturnType<typeof osmBuildingsOverCuenca> & { tiles?: unknown[] };
    layer.context = { viewport: viewportOver(-79.0, -2.894, 1700) };
    layer.state = { tileset3d: ts, activeViewports: { main: 'vp' }, lastUpdatedViewports: null, frameNumber: 1 };
    layer.updateState({});
    const content = buildingsContent([ts.modelMatrix[12], ts.modelMatrix[13], ts.modelMatrix[14]], batched);
    const tile = {
      id: 'blocks',
      tileset: ts,
      computedTransform: ts.modelMatrix.clone(),
      content,
      header: { boundingVolume: {} },
    };
    ts.tiles = [tile];
    return { layer, ts, content, tile };
  }

  const translation = (ts: { modelMatrix: ArrayLike<number> }) =>
    Math.hypot(ts.modelMatrix[12], ts.modelMatrix[13], ts.modelMatrix[14]);

  it('stops lowering the tileset by the ground under the view, and draws each building on the map', () => {
    const { layer, ts, content, tile } = loadedOverCuenca();
    expect(translation(ts)).toBeCloseTo(2490, 3);
    expect(drawnBases(content)[1] - drawnBases(content)[0]).toBeCloseTo(210, 0);

    layer._onTileLoad(tile);
    layer.updateState({});

    expect(translation(ts)).toBeLessThan(1e-6);
    drawnBases(content).forEach((base) => expect(base).toBeCloseTo(0, 1));
    expect(layer.traversals.length).toBeGreaterThan(1);

    // Moving the view does not bring the old grounding back.
    layer.context = { viewport: viewportOver(-79.01, -2.9, 1700) };
    layer.updateState({});
    expect(translation(ts)).toBeLessThan(1e-6);
  });

  it('lifts every building by the Height adjustment', () => {
    const { layer, ts, content, tile } = loadedOverCuenca();
    layer._onTileLoad(tile);
    layer.updateState({});

    layer.props = { ...layer.props, altitudeOffset: 20 };
    layer.updateState({});
    expect(translation(ts)).toBeCloseTo(20, 6);
    drawnBases(content).forEach((base) => expect(base).toBeCloseTo(20, 1));
  });

  it('puts the buildings back at their real altitude with Sit on the ground off, and on the map again with it on', () => {
    const { layer, ts, content, tile } = loadedOverCuenca();
    const { POSITION } = content.gltf.scenes[0].nodes[0].mesh.primitives[0].attributes;
    const loaded = POSITION.value;
    layer._onTileLoad(tile);
    layer.updateState({});
    const flattened = layer.traversals.length;

    layer.props = { ...layer.props, groundTileset: false };
    layer.updateState({});
    expect(POSITION.value).toBe(loaded);
    expect(translation(ts)).toBeLessThan(1e-6);
    const [centre, rise] = drawnBases(content);
    expect(centre).toBeCloseTo(2490, 0);
    expect(rise).toBeCloseTo(2700, 0);
    expect(layer.traversals.length).toBeGreaterThan(flattened);

    layer.props = { ...layer.props, groundTileset: true };
    layer.updateState({});
    drawnBases(content).forEach((base) => expect(base).toBeCloseTo(0, 1));
  });

  it('culls its tiles where the buildings are drawn, from the map up', () => {
    const { layer, ts, tile } = loadedOverCuenca();
    const blocks = (ts.roots['kepler-map'] as any).children[0].children[0];
    layer._onTileLoad(tile);
    layer.updateState({});
    expect(blocks.header.boundingVolume.box).toHaveLength(12);

    layer.props = { ...layer.props, groundTileset: false };
    layer.updateState({});
    expect(blocks.header.boundingVolume.box).toBeUndefined();
  });

  it('draws a tile that loads afterwards on the map as it loads, and has deck build it again', () => {
    const { layer, ts, tile } = loadedOverCuenca();
    layer._onTileLoad(tile);
    layer.updateState({});

    const later = buildingsContent();
    const layerMap = { later: { layer: { id: 'later-sublayer' }, needsUpdate: false } };
    layer.state = { ...layer.state, layerMap };
    layer._onTileLoad({ id: 'later', tileset: ts, computedTransform: ts.modelMatrix.clone(), content: later });
    drawnBases(later).forEach((base) => expect(base).toBeCloseTo(0, 1));
    expect(layerMap.later.needsUpdate).toBe(true);
  });

  it('culls the tiles of a nested tileset that loads afterwards where their buildings are drawn', () => {
    const { layer, ts, tile } = loadedOverCuenca();
    layer._onTileLoad(tile);
    layer.updateState({});

    const region = [-1.37916, -0.05066, -1.37846, -0.05036, 2490, 2610];
    const child = { header: { boundingVolume: { region } }, children: [] };
    const nested = { hasTilesetContent: true, tileset: ts, header: { boundingVolume: {} }, children: [child] };
    layer._onTileLoad(nested);
    expect(child.header.boundingVolume).toHaveProperty('box');
  });

  it('keeps lowering a mesh with no feature ids, like Google’s, by the ground under the view', () => {
    const { layer, ts, content, tile } = loadedOverCuenca(false);
    const positions = content.gltf.scenes[0].nodes[0].mesh.primitives[0].attributes.POSITION.value;
    layer._onTileLoad(tile);
    layer.updateState({});
    expect(translation(ts)).toBeCloseTo(2490, 3);
    expect(content.gltf.scenes[0].nodes[0].mesh.primitives[0].attributes.POSITION.value).toBe(positions);
  });
});
