import { TILE3D_ALTITUDE_VIS_CONFIGS, altitudeAware, withTile3dAltitude } from './tile3dAltitudeLayer';

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

/** Stands in for deck's `Tile3DLayer`: the three members the subclass touches. */
class FakeDeckLayer {
  static layerName = 'KeplerTile3DLayer';
  static defaultProps = { data: null, opacity: 1 };

  props: Record<string, unknown>;
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

  it('survives an update before the tileset has loaded', () => {
    const Aware = altitudeAware(FakeDeckLayer as never) as never as new (
      props: Record<string, unknown>
    ) => FakeDeckLayer;
    const layer = new Aware({ groundTileset: true });

    expect(() => layer.updateState({})).not.toThrow();
    expect(layer.traversals).toHaveLength(0);
  });
});
