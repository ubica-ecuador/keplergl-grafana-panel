import {
  colorForSpeed,
  fieldBounds,
  FlowFieldContext,
  levelHeight,
  makeFlowFieldLayer,
  setting,
  speedDomainOf,
  traceSignature,
} from './flowFieldLayer';

/** A stand-in for kepler's base Layer, with only what the subclass touches. */
class FakeBaseLayer {
  id = 'layer-1';
  config: Record<string, any> = { visConfig: {} };
  visConfigSettings: Record<string, unknown> = {};

  constructor(props?: Record<string, unknown>) {
    this.config = { ...this.getDefaultLayerConfig(props), ...props, visConfig: {} };
  }

  getDefaultLayerConfig(_props?: Record<string, unknown>): Record<string, unknown> {
    return { isVisible: true };
  }

  /** kepler's own: a preset name takes its default, a literal brings its own. */
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

  meta: Record<string, unknown> = {};

  updateMeta(meta: Record<string, unknown>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }
}

const built: Array<Record<string, unknown>> = [];
const fakeBuild = (props: Record<string, unknown>) => {
  built.push(props);
  return { props };
};

/**
 * A camera looking straight down at a box of ground, which is the whole of what
 * the layer asks a camera for.
 *
 * The box rides on the camera rather than being derived from its zoom: what is
 * under test here is that the layer hands the tracer a camera and honours what
 * it says, not the projection maths — that belongs to deck, and
 * `flowFieldDeckLayer.ts` is where it is asked for.
 */
type Ground = { west: number; east: number; south: number; north: number };
type TestCamera = {
  latitude: number; longitude: number; zoom: number; pitch: number; bearing: number;
  width: number; height: number;
  /** The ground on screen. */
  box: Ground;
  /** What sets metres per pixel, when it is not the box — a tilted camera. */
  scaleBox?: Ground;
};

const cameraShowing = (box: TestCamera['box'], width = 800, height = 800): TestCamera => ({
  latitude: (box.south + box.north) / 2,
  longitude: (box.west + box.east) / 2,
  zoom: 8,
  pitch: 0,
  bearing: 0,
  width,
  height,
  box,
});

const fakeCamera = (camera: any) => {
  const box = (camera as TestCamera).box;
  // The scale and the visible ground are two different questions, and deck
  // answers them separately: metres per pixel falls out of the zoom, while the
  // ground on screen is sampled and grows as the camera tilts. A double that
  // ties them together cannot see the difference — which is exactly the bug
  // that got past it once.
  const scale = (camera as TestCamera).scaleBox ?? box;
  const spanLng = box.east - box.west;
  const spanLat = box.north - box.south;
  return {
    widthPx: camera.width,
    heightPx: camera.height,
    bounds: box,
    metresPerPixel: ((scale.east - scale.west) * 111_320) / camera.width,
    unproject: (x: number, y: number): [number, number] => [
      box.west + (x / camera.width) * spanLng,
      box.south + (1 - y / camera.height) * spanLat,
    ],
  };
};

const FlowFieldLayer = makeFlowFieldLayer(FakeBaseLayer, fakeBuild, fakeCamera as never) as unknown as new (
  props?: Record<string, unknown>
) => any;

/** A kepler dataset holding a grid, in the shape `formatLayerData` reads. */
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

/** A square lattice carrying a steady eastward wind. */
function eastwardGrid(side: number, speed = 12, altitude?: number) {
  const rows: Array<Record<string, number>> = [];
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      rows.push({
        latitude: j,
        longitude: i,
        u: speed,
        v: 0,
        ...(altitude === undefined ? {} : { altitude }),
      });
    }
  }
  return gridDataset(rows);
}

const CONTEXT: FlowFieldContext = { baseMs: 1_000, tallest: 0 };

function layerOver(
  dataset: ReturnType<typeof gridDataset>,
  columnKeys: Record<string, string>,
  visConfig: Record<string, unknown> = {},
  columnMode = 'components'
) {
  const layer = new FlowFieldLayer({ dataId: 'grafana-A' });
  layer.config.dataId = 'grafana-A';
  layer.config.columnMode = columnMode;
  layer.config.columns = Object.fromEntries(
    Object.entries(columnKeys).map(([key, name]) => [key, { value: name, fieldIdx: dataset.columnIndex[name] }])
  );
  layer.config.visConfig = { ...layer.config.visConfig, density: 500, flowContext: CONTEXT, ...visConfig };
  return layer;
}

const COMPONENTS = { lat: 'latitude', lng: 'longitude', u: 'u', v: 'v' };

describe('flow field layer — tracing', () => {
  it('traces paths through the grid the columns point at', () => {
    const dataset = eastwardGrid(6);
    const layer = layerOver(dataset, COMPONENTS);

    const data = layer.formatLayerData({ 'grafana-A': dataset });

    expect(data.data.length).toBeGreaterThan(0);
    const [line] = data.data;
    expect(line.path.length).toBeGreaterThan(1);
    expect(line.path.every((vertex: number[]) => vertex.length === 4)).toBe(true);

    // A purely eastward wind moves the particle east at constant latitude.
    const lons = line.path.map((vertex: number[]) => vertex[0]);
    expect(lons.every((lon: number, i: number) => i === 0 || lon > lons[i - 1])).toBe(true);
  });

  it('reads speed and direction when that is how the query spells velocity', () => {
    const rows: Array<Record<string, number>> = [];
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 6; i++) {
        // 270° is a westerly: air moving east.
        rows.push({ latitude: j, longitude: i, ws: 10, wd: 270 });
      }
    }
    const dataset = gridDataset(rows);
    const layer = layerOver(dataset, { lat: 'latitude', lng: 'longitude', speed: 'ws', direction: 'wd' }, {}, 'polar');

    const [line] = layer.formatLayerData({ 'grafana-A': dataset }).data;

    expect(line.path[1][0]).toBeGreaterThan(line.path[0][0]);
  });

  it('traces the grid as it came when the smoothing is turned off', () => {
    // Zero has to survive as zero: read as "missing" it would silently smooth,
    // and the two pictures differ most exactly where the field is roughest.
    const dataset = eastwardGrid(6);
    const smoothed = layerOver(dataset, COMPONENTS).formatLayerData({ 'grafana-A': dataset });
    const raw = layerOver(dataset, COMPONENTS, { smoothing: 0 }).formatLayerData({ 'grafana-A': dataset });

    expect(raw.data.length).toBeGreaterThan(0);
    expect(smoothed.data.length).toBeGreaterThan(0);
  });

  it('draws nothing from rows that are not a lattice', () => {
    // A handful of weather stations has gaps of no particular size. Refusing is
    // what lets the map stay honest rather than draw an invented grid.
    const dataset = gridDataset([
      { latitude: 0, longitude: 0, u: 1, v: 0 },
      { latitude: 0.31, longitude: 1.7, u: 1, v: 0 },
      { latitude: 2.02, longitude: 5.3, u: 1, v: 0 },
    ]);

    expect(layerOver(dataset, COMPONENTS).formatLayerData({ 'grafana-A': dataset }).data).toEqual([]);
  });

  it('hands back no layer data at all when the dataset is missing', () => {
    expect(layerOver(eastwardGrid(4), COMPONENTS).formatLayerData({})).toEqual({});
  });
});

describe('flow field layer — reusing the trace', () => {
  /**
   * This is the mechanism the whole layer rests on. kepler recalculates the data
   * of every animatable layer whose type is not `trip` on every frame of the
   * animation, so a trace that ran each time would be nine thousand lines, sixty
   * times a second.
   */
  it('returns the previous trace untouched when nothing relevant changed', () => {
    const dataset = eastwardGrid(6);
    const layer = layerOver(dataset, COMPONENTS);

    const first = layer.formatLayerData({ 'grafana-A': dataset });
    const second = layer.formatLayerData({ 'grafana-A': dataset }, first);

    expect(second).toBe(first);
  });

  it('re-traces when a knob that shapes the lines moves', () => {
    const dataset = eastwardGrid(6);
    const layer = layerOver(dataset, COMPONENTS);

    const first = layer.formatLayerData({ 'grafana-A': dataset });
    layer.config.visConfig = { ...layer.config.visConfig, density: 150 };
    const second = layer.formatLayerData({ 'grafana-A': dataset }, first);

    expect(second).not.toBe(first);
    expect(second.data.length).toBeLessThan(first.data.length);
  });

  it('re-traces when the map settles somewhere else', () => {
    const dataset = eastwardGrid(8);
    const layer = layerOver(dataset, COMPONENTS);

    const first = layer.formatLayerData({ 'grafana-A': dataset });
    layer.config.visConfig = {
      ...layer.config.visConfig,
      flowContext: { ...CONTEXT, camera: cameraShowing({ west: 0, east: 4, south: 0, north: 4 }) },
    };
    const second = layer.formatLayerData({ 'grafana-A': dataset }, first);

    expect(second).not.toBe(first);
  });

  it('re-traces when the query returns new rows', () => {
    // The rows cannot be summarised into the signature, so they are compared by
    // identity: a refresh hands kepler a new container for the same columns.
    const layer = layerOver(eastwardGrid(6), COMPONENTS);
    const first = layer.formatLayerData({ 'grafana-A': eastwardGrid(6) });
    const second = layer.formatLayerData({ 'grafana-A': eastwardGrid(6) }, first);

    expect(second).not.toBe(first);
  });

  it('re-traces when the seamless loop is switched off', () => {
    // It changes the geometry, not the painting: the lines that would cross the
    // loop stop being drawn a second time, and every birth moves.
    const dataset = eastwardGrid(6);
    const layer = layerOver(dataset, COMPONENTS);

    const first = layer.formatLayerData({ 'grafana-A': dataset });
    layer.config.visConfig = { ...layer.config.visConfig, seamlessLoop: false };
    const second = layer.formatLayerData({ 'grafana-A': dataset }, first);

    expect(second).not.toBe(first);
    // Fewer lines drawn, because none is drawn twice any more.
    expect(second.data.length).toBeLessThan(first.data.length);
  });

  it('leaves the trace alone when only the trail length changed', () => {
    // Trail length is drawn, not traced. Re-tracing on it would make the
    // slider feel like a rebuild of the map.
    const dataset = eastwardGrid(6);
    const layer = layerOver(dataset, COMPONENTS);

    const first = layer.formatLayerData({ 'grafana-A': dataset });
    layer.config.visConfig = { ...layer.config.visConfig, trailShare: 20 };

    expect(layer.formatLayerData({ 'grafana-A': dataset }, first)).toBe(first);
  });
});

describe('flow field layer — the clock', () => {
  it('runs every streamline over one window starting at the dashboard range', () => {
    const dataset = eastwardGrid(6);
    const layer = layerOver(dataset, COMPONENTS, { cycleSeconds: 30 });

    layer.formatLayerData({ 'grafana-A': dataset });

    expect(layer.config.animation).toEqual({ enabled: true, domain: [1_000, 31_000] });
  });

  it('traces the vertex times from zero, not from the epoch', () => {
    // deck holds a vertex time as a float32, which cannot tell two epoch
    // milliseconds apart. `renderLayer` puts the base back on the playhead.
    const dataset = eastwardGrid(6);
    const layer = layerOver(dataset, COMPONENTS, { cycleSeconds: 30, density: 500 });

    const { data } = layer.formatLayerData({ 'grafana-A': dataset });
    const times = data.flatMap((line: { path: number[][] }) => line.path.map((vertex) => vertex[3]));

    // Within a cycle either side of it, rather than exactly inside it: a line
    // carried across the loop is drawn a whole cycle early, so its times are
    // negative. What matters is that they are thousands rather than the 1.7e12
    // of an epoch, which is the number float32 cannot tell apart.
    expect(times.every((t: number) => Math.abs(t) <= 60_000)).toBe(true);
  });
});

describe('flow field layer — following the view', () => {
  const dataset = eastwardGrid(8);

  const spanOf = (halfWidth: number) => {
    const layer = layerOver(dataset, COMPONENTS, {
      flowContext: {
        ...CONTEXT,
        camera: cameraShowing({
          west: 4 - halfWidth,
          east: 4 + halfWidth,
          south: 4 - halfWidth,
          north: 4 + halfWidth,
        }),
      },
    });
    const [line] = layer.formatLayerData({ 'grafana-A': dataset }).data;
    return Math.abs(line.path[line.path.length - 1][0] - line.path[0][0]);
  };

  it('shortens the lines on the ground as the map zooms in', () => {
    // The point of the whole exercise: a fixed number of lines per screen, each
    // a fixed number of pixels long, so the field reads the same at every scale.
    expect(spanOf(4) / spanOf(1)).toBeCloseTo(4, 1);
  });
});

describe('flow field layer — height', () => {
  const contextWith = (tallest: number) => ({
    ...CONTEXT,
    tallest,
    camera: cameraShowing({ west: 0, east: 8, south: 0, north: 8 }),
  });

  const heightOf = (altitude: number, tallest: number, elevationScale = 1) => {
    const dataset = eastwardGrid(8, 12, altitude);
    const layer = layerOver(
      dataset,
      { ...COMPONENTS, altitude: 'altitude' },
      { flowContext: contextWith(tallest), elevationScale }
    );
    const [line] = layer.formatLayerData({ 'grafana-A': dataset }).data;
    return line.path[0][2] as number;
  };

  it('keeps the levels in proportion by exaggerating against the tallest', () => {
    // One factor for the whole stack, so 110 m and 3000 m stay in their real
    // ratio — otherwise the levels would be evenly spaced regardless of how far
    // apart they actually are.
    expect(heightOf(3000, 3000) / heightOf(110, 3000)).toBeCloseTo(3000 / 110, 1);
  });

  it('leaves a level on the ground when no altitude column is bound', () => {
    const dataset = eastwardGrid(8);
    const layer = layerOver(dataset, COMPONENTS, { flowContext: contextWith(0) });
    const [line] = layer.formatLayerData({ 'grafana-A': dataset }).data;

    expect(line.path.every((vertex: number[]) => vertex[2] === 0)).toBe(true);
  });

  it('lifts a level set by hand when the query returns no height column', () => {
    // The ordinary case: nothing autodetects an altitude, and a level's height
    // is a property of the query rather than of its rows. With `tallest` at
    // zero the automatic factor is 1, so the metres arrive on the geometry
    // unchanged and can be read straight off it.
    const dataset = eastwardGrid(8);
    const layer = layerOver(dataset, COMPONENTS, { flowContext: contextWith(0), heightMeters: 2500 });
    const [line] = layer.formatLayerData({ 'grafana-A': dataset }).data;

    expect(line.path.every((vertex: number[]) => vertex[2] === 2500)).toBe(true);
  });

  it('lets the column win over the knob when both are there', () => {
    const dataset = eastwardGrid(8, 12, 900);
    const layer = layerOver(
      dataset,
      { ...COMPONENTS, altitude: 'altitude' },
      { flowContext: contextWith(0), heightMeters: 2500 }
    );
    const [line] = layer.formatLayerData({ 'grafana-A': dataset }).data;

    expect(line.path[0][2]).toBe(900);
  });

  it('re-traces when the height set by hand changes', () => {
    const dataset = eastwardGrid(8);
    const layer = layerOver(dataset, COMPONENTS, { flowContext: contextWith(0) });
    const first = layer.formatLayerData({ 'grafana-A': dataset });
    layer.config.visConfig = { ...layer.config.visConfig, heightMeters: 2500 };

    expect(layer.formatLayerData({ 'grafana-A': dataset }, first)).not.toBe(first);
  });

  it('scales the whole stack by the exaggeration the user asked for', () => {
    expect(heightOf(3000, 3000, 2) / heightOf(3000, 3000, 1)).toBeCloseTo(2, 5);
  });

  it('does not lift the stack when the camera merely tilts', () => {
    // The regression this exists for. Tilting turns the ground on screen into a
    // trapezoid running to the horizon, and measuring the view by *that* made a
    // 3 km level draw at 600 km — the whole stack slid off the top of the map.
    // How wide a view is does not change when you tilt the camera.
    const dataset = eastwardGrid(8, 12, 3000);
    const columns = { ...COMPONENTS, altitude: 'altitude' };
    const flatBox = { west: 0, east: 8, south: 0, north: 8 };

    const heightWith = (bounds: typeof flatBox) => {
      // Same zoom, so the same metres per pixel; only the ground on screen grows.
      const camera = { ...cameraShowing(flatBox), box: bounds, scaleBox: flatBox };
      const layer = layerOver(dataset, columns, { flowContext: { ...CONTEXT, tallest: 3000, camera } });
      return layer.formatLayerData({ 'grafana-A': dataset }).data[0].path[0][2] as number;
    };

    // The same camera, but seeing ground stretching four times further away.
    expect(heightWith({ west: -8, east: 16, south: 0, north: 32 })).toBeCloseTo(heightWith(flatBox), 5);
  });

  it('flattens the stack when the exaggeration is turned down to zero', () => {
    expect(heightOf(3000, 3000, 0)).toBe(0);
  });
});

describe('flow field layer — drawing', () => {
  const dataset = eastwardGrid(6);

  beforeEach(() => {
    built.length = 0;
  });

  it('gives deck the playhead relative to the window the lines were traced in', () => {
    const layer = layerOver(dataset, COMPONENTS, { cycleSeconds: 60 });
    const data = layer.formatLayerData({ 'grafana-A': dataset });

    layer.renderLayer({ data, animationConfig: { currentTime: 21_000, domain: [1_000, 61_000] } });

    expect(built[0].currentTime).toBe(20_000);
  });

  it('measures the trail against the cycle, not against a bare number', () => {
    // kepler's own `trailLength` default is 180. The vertex times here are
    // milliseconds over a sixty-second window, so that is three tenths of one
    // percent of the animation: every streamline draws as a dot and the field
    // reads as static rather than flow.
    const layer = layerOver(dataset, COMPONENTS, { cycleSeconds: 60, trailShare: 5 });
    const data = layer.formatLayerData({ 'grafana-A': dataset });

    layer.renderLayer({ data, animationConfig: { currentTime: 21_000, domain: [1_000, 61_000] } });

    expect(built[0].trailLength).toBe(3_000);
  });

  it('draws nothing before the clock has a value', () => {
    // A paused field is a blank map: at the start of the window every trail has
    // zero length, and with no playhead at all there is no window.
    const layer = layerOver(dataset, COMPONENTS);
    const data = layer.formatLayerData({ 'grafana-A': dataset });

    expect(layer.renderLayer({ data, animationConfig: {} })).toEqual([]);
  });

  it('switches itself off when the layer is hidden', () => {
    // kepler hands deck every layer, visible or not, and expects each one to
    // read this prop. A layer that ignores it cannot be switched off at all —
    // the eye in the layer panel changes the state and nothing on the map.
    const layer = layerOver(dataset, COMPONENTS);
    const data = layer.formatLayerData({ 'grafana-A': dataset });
    layer.config.isVisible = false;

    layer.renderLayer({ data, animationConfig: { currentTime: 5_000 } });

    expect(built[0].visible).toBe(false);
  });

  it('stays out of the split map panel it was not put in', () => {
    const layer = layerOver(dataset, COMPONENTS);
    const data = layer.formatLayerData({ 'grafana-A': dataset });

    layer.renderLayer({ data, animationConfig: { currentTime: 5_000 }, visible: false });

    expect(built[0].visible).toBe(false);
  });

  it('draws when it is visible and this panel is its panel', () => {
    const layer = layerOver(dataset, COMPONENTS);
    const data = layer.formatLayerData({ 'grafana-A': dataset });

    layer.renderLayer({ data, animationConfig: { currentTime: 5_000 }, visible: true });

    expect(built[0].visible).toBe(true);
  });

  it('draws nothing when the field traced no lines', () => {
    const layer = layerOver(dataset, COMPONENTS);

    expect(
      layer.renderLayer({
        data: { data: [], speedDomain: [0, 1], signature: '', container: null },
        animationConfig: { currentTime: 5 },
      })
    ).toEqual([]);
  });
});

describe('flow field layer — where the field is', () => {
  it('reports the grid’s extent, so the map can frame itself on it', () => {
    // Not decoration: `centerMap` frames on the union of its layers' bounds and
    // the viewport guard restores that union after kepler's view-state echo
    // clobbers the load. Without it the map opens over kepler's default San
    // Francisco while the data sits in Ecuador.
    const dataset = eastwardGrid(6);
    const layer = layerOver(dataset, COMPONENTS);

    layer.formatLayerData({ 'grafana-A': dataset });

    expect(layer.meta.bounds).toEqual([0, 0, 5, 5]);
  });
});

describe('fieldBounds', () => {
  it('spans the last cell of the lattice, not the first', () => {
    const field = {
      data: new Float32Array(0),
      columns: 5,
      rows: 3,
      west: -79.75,
      south: -3.5,
      stepLon: 0.25,
      stepLat: 0.25,
    };

    expect(fieldBounds(field)).toEqual([-79.75, -3.5, -78.75, -3]);
  });
});

describe('levelHeight', () => {
  it('reads the column when one is bound', () => {
    expect(levelHeight('altitude', 900, { heightMeters: 2500 })).toBe(900);
  });

  it('falls back to the knob when no column is bound', () => {
    expect(levelHeight(null, 0, { heightMeters: 2500 })).toBe(2500);
    expect(levelHeight(undefined, 0, { heightMeters: 2500 })).toBe(2500);
  });

  it('leaves a layer on the ground when neither says anything', () => {
    expect(levelHeight(null, 0, {})).toBe(0);
  });
});

describe('setting', () => {
  it('keeps a zero the user actually chose', () => {
    // Zero is a real answer to two of these: no smoothing, and a flat stack.
    expect(setting(0, 3)).toBe(0);
  });

  it('falls back when the layer carries no answer', () => {
    // `Number(undefined)` is NaN, which `??` does not catch — and a NaN
    // exaggeration puts every vertex at NaN metres and the layer nowhere.
    expect(setting(undefined, 3)).toBe(3);
    expect(setting(null, 3)).toBe(3);
    expect(setting('twelve', 3)).toBe(3);
  });
});

describe('speedDomainOf', () => {
  it('spans the speeds the lines actually carry', () => {
    expect(speedDomainOf([{ path: [], speed: 3 }, { path: [], speed: 11 }])).toEqual([3, 11]);
  });

  it('never returns a zero-width domain', () => {
    // A field of uniform speed would divide by zero and paint every line the
    // ramp's first colour, which reads as the ramp being broken.
    expect(speedDomainOf([{ path: [], speed: 7 }])).toEqual([7, 8]);
  });
});

describe('colorForSpeed', () => {
  const ramp = ['#000000', '#7f7f7f', '#ffffff'];

  it('puts the slowest line on the first colour and the fastest on the last', () => {
    expect(colorForSpeed(ramp, [0, 30], 0)).toEqual([0, 0, 0]);
    expect(colorForSpeed(ramp, [0, 30], 30)).toEqual([255, 255, 255]);
  });

  it('quantises over the ramp’s own steps', () => {
    expect(colorForSpeed(ramp, [0, 30], 15)).toEqual([127, 127, 127]);
  });

  it('holds the ends rather than running off the ramp', () => {
    expect(colorForSpeed(ramp, [10, 20], 5)).toEqual([0, 0, 0]);
    expect(colorForSpeed(ramp, [10, 20], 99)).toEqual([255, 255, 255]);
  });
});

describe('traceSignature', () => {
  it('ignores the knobs that only change how the lines are painted', () => {
    const base = { columns: {}, visConfig: { density: 900, trailShare: 4 } };
    const painted = { columns: {}, visConfig: { density: 900, trailShare: 30, colorBySpeed: false } };

    expect(traceSignature(painted)).toBe(traceSignature(base));
  });

  it('changes when the columns are pointed somewhere else', () => {
    const before = { columns: { u: { value: 'u' } }, visConfig: {} };
    const after = { columns: { u: { value: 'ugrd' } }, visConfig: {} };

    expect(traceSignature(after)).not.toBe(traceSignature(before));
  });
});
