import { makeVectorFieldLayer, symbolSignature } from './vectorFieldLayer';

/** A stand-in for kepler's base Layer, with only what the subclass touches. */
class FakeBaseLayer {
  id = 'layer-1';
  config: Record<string, any> = { visConfig: {} };
  visConfigSettings: Record<string, unknown> = {};
  meta: Record<string, unknown> = {};

  constructor(props?: Record<string, unknown>) {
    this.config = { ...this.getDefaultLayerConfig(props), ...props, visConfig: {} };
  }

  /** kepler's own default: a layer is not animated unless it says so. */
  getDefaultLayerConfig(_props?: Record<string, unknown>): Record<string, unknown> {
    return { isVisible: true, animation: { enabled: false, domain: null } };
  }

  registerVisConfig(configs: Record<string, any>): void {
    for (const [key, item] of Object.entries(configs)) {
      if (typeof item === 'object' && 'defaultValue' in item) {
        this.config.visConfig[key] = item.defaultValue;
        this.visConfigSettings[key] = item;
      }
    }
  }

  updateLayerConfig(patch: Record<string, unknown>): this {
    this.config = { ...this.config, ...patch };
    return this;
  }

  updateMeta(meta: Record<string, unknown>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }

  getVisualChannelDescription(_key: string): { label: string; measure?: string } {
    return { label: '', measure: undefined };
  }
}

const built: Array<Record<string, any>> = [];
const fakeBuild = (props: Record<string, unknown>) => {
  built.push(props);
  return { props };
};

type Box = { west: number; east: number; south: number; north: number };

/** A camera looking straight down at a box, 800 × 400 px. */
const cameraShowing = (box: Box) => ({ latitude: 0, longitude: 0, zoom: 8, pitch: 0, bearing: 0, width: 800, height: 400, box });

const fakeCamera = (camera: any) => ({
  widthPx: camera.width,
  heightPx: camera.height,
  bounds: camera.box,
  metresPerPixel: ((camera.box.east - camera.box.west) * 111_320) / camera.width,
  unproject: (x: number, y: number): [number, number] => [
    camera.box.west + (x / camera.width) * (camera.box.east - camera.box.west),
    camera.box.north - (y / camera.height) * (camera.box.north - camera.box.south),
  ],
});

const VectorFieldLayer = makeVectorFieldLayer(FakeBaseLayer, fakeBuild, fakeCamera as never) as unknown as new (
  props?: Record<string, unknown>
) => any;

/** A kepler dataset holding rows, in the shape `formatLayerData` reads. */
function gridDataset(rows: Array<Record<string, number>>) {
  const names = Object.keys(rows[0] ?? {});
  return {
    dataContainer: {
      numRows: () => rows.length,
      valueAt: (row: number, column: number) => rows[row][names[column]],
    },
    fields: names.map((name) => ({ name })),
    columnIndex: Object.fromEntries(names.map((name, index) => [name, index])),
  };
}

/** A square lattice, one degree apart, of a steady eastward wind. */
function eastwardGrid(side: number, speed = 10, south = 0) {
  const rows: Array<Record<string, number>> = [];
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      rows.push({ latitude: south + j, longitude: i, u: speed, v: 0 });
    }
  }
  return gridDataset(rows);
}

const COMPONENTS = { lat: 'latitude', lng: 'longitude', u: 'u', v: 'v' };

function layerOver(
  dataset: ReturnType<typeof gridDataset>,
  columnKeys: Record<string, string>,
  visConfig: Record<string, unknown> = {},
  columnMode = 'components',
  // A different layer class only for the one test that needs a deck factory
  // that fails to build — every other caller wants the module's own.
  LayerClass: new (props?: Record<string, unknown>) => any = VectorFieldLayer
) {
  const layer = new LayerClass({ dataId: 'grafana-A' });
  layer.config.dataId = 'grafana-A';
  layer.config.columnMode = columnMode;
  layer.config.columns = Object.fromEntries(
    Object.entries(columnKeys).map(([key, name]) => [key, { value: name, fieldIdx: dataset.columnIndex[name] }])
  );
  layer.config.visConfig = { ...layer.config.visConfig, flowContext: { baseMs: 0, tallest: 0 }, ...visConfig };
  return layer;
}

const RAMP = { colors: ['#000000', '#555555', '#aaaaaa', '#ffffff'] };

describe('vector field layer — placing symbols', () => {
  it('puts a symbol on every node in the data cells placement', () => {
    const dataset = eastwardGrid(3);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'cells' });

    const { data } = layer.formatLayerData({ 'grafana-A': dataset });

    expect(data).toHaveLength(9);
    expect(data[0]).toMatchObject({ position: [0, 0, 0], speed: 10, southern: false });
    // From atan2 and a conversion to degrees, so near 90 rather than exactly it.
    expect(data[0].bearingTo).toBeCloseTo(90, 9);
  });

  it('puts a symbol in every cell of the screen in the screen placement', () => {
    // 800 × 400 in cells of 100 is 32, and the box sits wholly inside the field.
    const dataset = eastwardGrid(3);
    const layer = layerOver(dataset, COMPONENTS, {
      placement: 'screen',
      spacingPx: 100,
      flowContext: { baseMs: 0, tallest: 0, camera: cameraShowing({ west: 0, east: 2, south: 0, north: 2 }) },
    });

    expect(layer.formatLayerData({ 'grafana-A': dataset }).data).toHaveLength(32);
  });

  it('falls back to the data cells while the screen has not been described yet', () => {
    const dataset = eastwardGrid(3);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'screen' });

    expect(layer.formatLayerData({ 'grafana-A': dataset }).data).toHaveLength(9);
  });

  it('marks the symbols south of the equator, whose barbs fly on the other side', () => {
    const dataset = eastwardGrid(3, 10, -5);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'cells' });

    expect(layer.formatLayerData({ 'grafana-A': dataset }).data.every((s: { southern: boolean }) => s.southern)).toBe(true);
  });

  it('keeps the symbols when only the camera moved and they sit on the data', () => {
    const dataset = eastwardGrid(3);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'cells' });
    const first = layer.formatLayerData({ 'grafana-A': dataset });

    layer.config.visConfig = {
      ...layer.config.visConfig,
      flowContext: { baseMs: 0, tallest: 0, camera: cameraShowing({ west: 0, east: 1, south: 0, north: 1 }) },
    };

    expect(layer.formatLayerData({ 'grafana-A': dataset }, first)).toBe(first);
  });

  it('places the symbols again when the camera moved and they follow the screen', () => {
    const dataset = eastwardGrid(3);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'screen' });
    const first = layer.formatLayerData({ 'grafana-A': dataset });

    layer.config.visConfig = {
      ...layer.config.visConfig,
      flowContext: { baseMs: 0, tallest: 0, camera: cameraShowing({ west: 0, east: 2, south: 0, north: 2 }) },
    };

    expect(layer.formatLayerData({ 'grafana-A': dataset }, first)).not.toBe(first);
  });

  it('reports the extent of the grid and the speed range for the legend', () => {
    const dataset = eastwardGrid(3);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'cells' });

    layer.formatLayerData({ 'grafana-A': dataset });

    expect(layer.meta.bounds).toEqual([0, 0, 2, 2]);
    // A uniform 10 m/s, widened to a range that can be divided by.
    expect(layer.config.flowColorDomain).toEqual([10, 11]);
    expect(layer.getVisualChannelDescription('color').measure).toBe('Speed');
  });

  it('asks for no clock', () => {
    // An animatable layer brings kepler's time widget; a still picture has no use for it.
    const layer = layerOver(eastwardGrid(3), COMPONENTS);

    expect(layer.config.animation?.enabled).not.toBe(true);
  });
});

describe('symbolSignature', () => {
  const at = (visConfig: Record<string, unknown>, columns: Record<string, { value: string }> = {}) =>
    symbolSignature({ columns, visConfig });
  const camera = (west: number) => ({ baseMs: 0, tallest: 0, camera: cameraShowing({ west, east: west + 1, south: 0, north: 1 }) });

  it('ignores the camera when the symbols sit on the data at ground level', () => {
    expect(at({ placement: 'cells', flowContext: camera(0) })).toBe(at({ placement: 'cells', flowContext: camera(5) }));
  });

  it('follows the camera when there is a height to exaggerate', () => {
    // The stack's exaggeration is worked out from the width of the view.
    expect(at({ placement: 'cells', heightMeters: 1500, flowContext: camera(0) })).not.toBe(
      at({ placement: 'cells', heightMeters: 1500, flowContext: camera(5) })
    );
  });

  it('follows the camera on the screen grid', () => {
    expect(at({ placement: 'screen', flowContext: camera(0) })).not.toBe(at({ placement: 'screen', flowContext: camera(5) }));
  });

  it('ignores the spacing slider on the data cells placement, which it changes nothing for', () => {
    expect(at({ placement: 'cells', spacingPx: 40 })).toBe(at({ placement: 'cells', spacingPx: 90 }));
  });

  it('follows the spacing slider on the screen grid, which it re-places symbols for', () => {
    expect(at({ placement: 'screen', spacingPx: 40 })).not.toBe(at({ placement: 'screen', spacingPx: 90 }));
  });

  it('follows the direction convention, which flips every bearing', () => {
    expect(at({ placement: 'cells', directionConvention: 'from' })).not.toBe(
      at({ placement: 'cells', directionConvention: 'towards' })
    );
  });
});

describe('vector field layer — drawing', () => {
  beforeEach(() => {
    built.length = 0;
  });

  /** What deck is handed for a 3 × 3 field, and its first symbol. */
  const drawnWith = (visConfig: Record<string, unknown>, dataset = eastwardGrid(3), columns = COMPONENTS, mode = 'components') => {
    const layer = layerOver(dataset, columns, { placement: 'cells', colorRange: RAMP, ...visConfig }, mode);
    const data = layer.formatLayerData({ 'grafana-A': dataset });
    layer.renderLayer({ data });
    const props = built[built.length - 1];
    const symbol = props.data[0];
    return {
      props,
      icon: () => props.getIcon(symbol),
      angle: () => props.getAngle(symbol),
      size: () => props.getSize(symbol),
      colour: () => Array.from(props.getColor(symbol) as number[]),
    };
  };

  it('turns an arrow to the bearing the flow goes', () => {
    // An eastward wind goes to 90°; deck turns counter-clockwise.
    const drawn = drawnWith({ symbol: 'arrow' });

    expect(drawn.icon()).toBe('arrow');
    expect(drawn.angle()).toBeCloseTo(-90, 9);
  });

  it('turns a barb to the bearing the wind comes from', () => {
    // 10 m/s is 19.4 kn, which a barb draws as 20; from the west is 270°.
    const drawn = drawnWith({ symbol: 'barb', speedUnit: 'm/s' });

    expect(drawn.icon()).toBe('barb-20-n');
    expect(drawn.angle()).toBeCloseTo(-270, 9);
  });

  it('draws the southern barb south of the equator', () => {
    expect(drawnWith({ symbol: 'barb', speedUnit: 'm/s' }, eastwardGrid(3, 10, -5)).icon()).toBe('barb-20-s');
  });

  it('reads the speed in the unit the data is in', () => {
    expect(drawnWith({ symbol: 'barb', speedUnit: 'kn' }).icon()).toBe('barb-10-n');
  });

  it('draws a barb and an arrow at the size set by hand', () => {
    expect(drawnWith({ symbol: 'barb', symbolSize: 30 }).size()).toBe(30);
    expect(drawnWith({ symbol: 'arrow', symbolSize: 30 }).size()).toBe(30);
  });

  it('sizes an arrow by its speed when asked', () => {
    // 10 is half of 0–20, so half way through 10–30.
    const drawn = drawnWith({ symbol: 'arrow', sizeBySpeed: true, sizeRange: [10, 30], fixedSpeedRange: true, speedRange: [0, 20] });

    expect(drawn.size()).toBe(20);
  });

  it('sizes and colours a classified arrow by the class it falls in', () => {
    // Four colours, four classes over 0–20; 10 falls in the third (index 2),
    // two steps of three up from 10 towards 40, and on the third colour.
    const drawn = drawnWith({ symbol: 'classified', sizeRange: [10, 40], fixedSpeedRange: true, speedRange: [0, 20] });

    expect(drawn.size()).toBe(30);
    expect(drawn.colour()).toEqual([170, 170, 170]);
  });

  it('fades by speed, as the flow field does', () => {
    // 0.2, plus half of the remaining 0.8, is 153 of 255.
    const drawn = drawnWith({ symbol: 'arrow', opacityBySpeed: true, calmOpacity: 0.2, fixedSpeedRange: true, speedRange: [0, 20] });

    expect(drawn.colour()[3]).toBe(153);
  });

  it('draws an arrow in place of a barb over a gradient', () => {
    // A slope is no wind, and has no knots to count.
    const rows: Array<Record<string, number>> = [];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        rows.push({ latitude: j, longitude: i, elev: 100 * i });
      }
    }
    const drawn = drawnWith({ symbol: 'barb' }, gridDataset(rows), { lat: 'latitude', lng: 'longitude', value: 'elev' } as never, 'gradient');

    expect(drawn.icon()).toBe('arrow');
  });

  it('draws no arrow where the air is still', () => {
    // Still air has no direction to point in.
    const { props } = drawnWith({ symbol: 'arrow' }, eastwardGrid(3, 0));

    expect(props.data).toHaveLength(0);
  });

  it('hands deck the same array on every render, so it need not redo per-symbol work each frame', () => {
    // kepler calls renderLayer on every map render — every pan, every hover,
    // sixty times a second while the layer is animated — and deck compares
    // `data` by reference to decide whether to touch the GPU buffers at all.
    // A fresh `.filter` on each call would defeat that, however cheap the
    // filter itself is.
    const rows = [
      { latitude: 0, longitude: 0, u: 10, v: 0 },
      { latitude: 0, longitude: 1, u: 0, v: 0 },
      { latitude: 1, longitude: 0, u: 10, v: 0 },
      { latitude: 1, longitude: 1, u: 10, v: 0 },
    ];
    const dataset = gridDataset(rows);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'cells', symbol: 'arrow', colorRange: RAMP });
    const data = layer.formatLayerData({ 'grafana-A': dataset });

    layer.renderLayer({ data });
    const first = built[built.length - 1].data;
    layer.renderLayer({ data });
    const second = built[built.length - 1].data;

    expect(second).toBe(first);
    // Still drops the still node, same as the test above.
    expect(first).toHaveLength(3);
    expect(first.every((s: { speed: number }) => s.speed > 0)).toBe(true);
  });

  it('switches itself off when hidden or out of its split pane', () => {
    const dataset = eastwardGrid(3);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'cells' });
    const data = layer.formatLayerData({ 'grafana-A': dataset });

    layer.renderLayer({ data, visible: false });
    expect(built[built.length - 1].visible).toBe(false);

    layer.config.isVisible = false;
    layer.renderLayer({ data });
    expect(built[built.length - 1].visible).toBe(false);
  });

  it('tells deck to size the symbols again when their knobs move', () => {
    const small = drawnWith({ symbol: 'arrow', sizeBySpeed: true, sizeRange: [10, 30] }).props.updateTriggers.getSize;
    const large = drawnWith({ symbol: 'arrow', sizeBySpeed: true, sizeRange: [10, 60] }).props.updateTriggers.getSize;

    expect(large).not.toEqual(small);
  });

  it('tells deck to fetch icons again when the speed unit changes', () => {
    const kn = drawnWith({ symbol: 'barb', speedUnit: 'kn' }).props.updateTriggers.getIcon;
    const ms = drawnWith({ symbol: 'barb', speedUnit: 'm/s' }).props.updateTriggers.getIcon;

    expect(kn).not.toEqual(ms);
  });

  it('drops a null deck layer instead of taking the map down with it', () => {
    // What `buildVectorFieldDeckLayer` returns when there is no 2D canvas
    // context left to paint the atlas into — see `vectorFieldDeckLayer.ts`.
    const FailingLayer = makeVectorFieldLayer(FakeBaseLayer, () => null, fakeCamera as never) as unknown as new (
      props?: Record<string, unknown>
    ) => any;
    const dataset = eastwardGrid(3);
    const layer = layerOver(dataset, COMPONENTS, { placement: 'cells', symbol: 'arrow', colorRange: RAMP }, 'components', FailingLayer);
    const data = layer.formatLayerData({ 'grafana-A': dataset });

    expect(layer.renderLayer({ data })).toEqual([]);
  });
});
