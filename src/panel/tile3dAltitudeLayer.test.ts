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

  constructor(props: Record<string, unknown>) {
    this.props = props;
  }

  updateState(_params: unknown): void {
    this.superCalls += 1;
  }

  _updateTileset(viewports: unknown): void {
    this.traversals.push(viewports);
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
    const ts = osmBuildingsOverCuenca();
    // Quito: the tree knows nothing small there yet.
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

  it('survives an update before the tileset has loaded', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true });

    expect(() => layer.updateState({})).not.toThrow();
    expect(layer.traversals).toHaveLength(0);
  });
});
