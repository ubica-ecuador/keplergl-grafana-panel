import {
  buildWindField,
  GridFrame,
  smoothWindField,
  WindField,
  WindFieldColumns,
} from '../data/buildWindField';
import { stackExaggeration, Streamline, traceStreamlines, Viewport } from '../data/traceStreamlines';

/**
 * The kepler layer that draws a grid of velocities as animated streamlines.
 *
 * Pure on purpose — no kepler, no deck, no network. It receives the base class
 * and the deck layer factory as arguments so it can be exercised with stubs, the
 * way `zarrTileLayer.ts` is; `flowFieldDeckLayer.ts` supplies the real ones.
 *
 * The division of labour is worth stating. The dataset holds the rows the query
 * returned — a lattice of `u,v` or speed/direction samples, dozens of them, not
 * thousands. Everything drawn is computed here: the field is assembled from
 * those columns, smoothed, and traced into the paths a massless particle would
 * take. That is why the knobs belong on the layer rather than on the panel:
 * they do not describe the data, they describe the drawing.
 */

/** Builds the deck layer — see `flowFieldDeckLayer.ts`. */
export type FlowFieldDeckLayerFactory = (props: Record<string, unknown>) => unknown;

/**
 * What the panel knows and the layer cannot work out for itself.
 *
 * Written into `visConfig` by `useFlowFieldContext`, and deliberately absent
 * from the layer panel — none of it is a choice the user makes. It travels
 * through `visConfig` because that is the one channel that reaches a layer
 * without touching its dataset, the same road `visConfig.zarrLabel` takes.
 */
export interface FlowFieldContext {
  /** What the map is showing, so seeding and step length follow the screen. */
  viewport?: Viewport;
  /** Epoch ms the animation starts from — the dashboard range's start. */
  baseMs: number;
  /**
   * The tallest level on the map, in metres.
   *
   * Shared across the flow field layers rather than taken from each layer's own
   * altitude: the exaggeration scales the whole stack to a share of the view, so
   * a layer computing it from its own height would draw every level at the same
   * altitude and flatten the stack it exists to separate.
   */
  tallest?: number;
}

/**
 * The knobs, and their defaults.
 *
 * The defaults are the constants this layer replaced, so a map that was drawn
 * before any of this existed comes back looking the same. Two of them earn a
 * word:
 *
 * `cycleSeconds` runs every streamline over one shared window, so the whole
 * field is on screen at all times and what moves is a short trail — the
 * earth.nullschool look. `lifeFraction` below 1 scatters the births through
 * that window, so trails appear and fade continuously instead of every line
 * restarting together when the animation loops.
 *
 * The trail is a **share of the cycle** rather than kepler's own `trailLength`,
 * which is an absolute number with a default of 180. The vertex times here are
 * milliseconds spanning a sixty-second window, so that default is three tenths
 * of one percent of the animation: every streamline draws as a dot, and the map
 * looks like static rather than flow. Expressed as a share, the look also
 * survives a change of cycle instead of having to be retuned after it.
 */
export const FLOW_FIELD_VIS_CONFIGS = {
  opacity: 'opacity',
  thickness: 'thickness',
  colorRange: 'colorRange',
  trailShare: {
    type: 'number',
    defaultValue: 4,
    label: 'flowfield.trailShare',
    isRanged: false,
    range: [0.5, 60],
    step: 0.5,
    group: 'stroke',
    property: 'trailShare',
  },
  density: {
    type: 'number',
    defaultValue: 9000,
    label: 'flowfield.density',
    isRanged: false,
    range: [500, 20000],
    step: 500,
    group: 'display',
    property: 'density',
  },
  lineLength: {
    type: 'number',
    defaultValue: 30,
    label: 'flowfield.lineLength',
    isRanged: false,
    range: [5, 60],
    step: 1,
    group: 'display',
    property: 'lineLength',
  },
  cycleSeconds: {
    type: 'number',
    defaultValue: 60,
    label: 'flowfield.cycleSeconds',
    isRanged: false,
    range: [5, 300],
    step: 5,
    group: 'display',
    property: 'cycleSeconds',
  },
  lifeFraction: {
    type: 'number',
    defaultValue: 0.55,
    label: 'flowfield.lifeFraction',
    isRanged: false,
    range: [0.1, 1],
    step: 0.05,
    group: 'display',
    property: 'lifeFraction',
  },
  smoothing: {
    type: 'number',
    defaultValue: 3,
    label: 'flowfield.smoothing',
    isRanged: false,
    range: [0, 8],
    step: 1,
    group: 'display',
    property: 'smoothing',
  },
  elevationScale: {
    type: 'number',
    defaultValue: 1,
    label: 'flowfield.elevationScale',
    isRanged: false,
    range: [0, 5],
    step: 0.1,
    group: 'display',
    property: 'elevationScale',
  },
  colorBySpeed: {
    type: 'boolean',
    defaultValue: true,
    label: 'flowfield.colorBySpeed',
    group: 'color',
    property: 'colorBySpeed',
  },
} as const;

/**
 * How the query spells the velocity, and which columns each spelling needs.
 *
 * kepler renders a column picker per required and optional column of the
 * selected mode, which is the whole reason the four velocity roles finally have
 * a place in the interface: until now they were autodetect-only.
 */
export const FLOW_FIELD_COLUMN_MODES = [
  {
    key: 'components',
    label: 'U / V components',
    requiredColumns: ['lat', 'lng', 'u', 'v'],
    optionalColumns: ['altitude'],
  },
  {
    key: 'polar',
    label: 'Speed / direction',
    requiredColumns: ['lat', 'lng', 'speed', 'direction'],
    optionalColumns: ['altitude'],
  },
];

/** One column of a kepler layer, as kepler stores it once the config is parsed. */
interface LayerColumn {
  value?: string | null;
  fieldIdx?: number;
}

/** The members of kepler's base layer this subclass touches. */
interface FlowFieldLayerLike {
  id: string;
  config: {
    dataId?: string;
    columns?: Record<string, LayerColumn>;
    columnMode?: string;
    color?: [number, number, number];
    animation?: { enabled?: boolean; domain?: [number, number] | null };
    visConfig?: Record<string, unknown>;
  };
  registerVisConfig(configs: Record<string, unknown>): void;
  updateLayerConfig(patch: Record<string, unknown>): unknown;
  updateMeta(meta: Record<string, unknown>): unknown;
  getDefaultLayerConfig(props?: Record<string, unknown>): Record<string, unknown>;
}

/** The kepler dataset a flow field reads: rows, and the columns they are in. */
export interface FlowFieldDataset {
  dataContainer?: { numRows(): number; valueAt(row: number, column: number): unknown };
  fields?: Array<{ name: string }>;
}

/** What `formatLayerData` hands back to `renderLayer`. */
export interface FlowFieldLayerData {
  /**
   * Named `data` rather than `streamlines` deliberately: kepler decides whether
   * to call `renderLayer` at all with `hasLayerData`, which asks for
   * `layerData.data.length`. A field that traced nothing then correctly draws
   * nothing, instead of the base class quietly skipping a layer that had lines.
   */
  data: Streamline[];
  /** The speed range the colour ramp is stretched over. */
  speedDomain: [number, number];
  /** Why this trace is what it is — see `traceSignature`. */
  signature: string;
  /** The rows it was traced from, compared by identity. */
  container: unknown;
}

// Contravariant constructor parameters, so `any[]` rather than `unknown[]`; the
// same reason `zarrTileLayer.ts` gives.
type Constructor<T> = new (...args: any[]) => T;

/**
 * Everything that decides what the streamlines look like, as one string.
 *
 * This is not an optimisation, it is the thing that makes the layer viable.
 * `setLayerAnimationTimeUpdater` recalculates the data of every animatable layer
 * whose type is not `trip` on **every frame of the animation** — the exclusion
 * exists because kepler's own Trip layer would not survive it either. Tracing
 * nine thousand lines sixty times a second is not a slow map, it is a dead tab.
 *
 * So the trace is kept and reused unless something in here changed. The rows
 * themselves are compared separately, by identity: they are not summarisable.
 */
export function traceSignature(config: FlowFieldLayerLike['config']): string {
  const visConfig = config.visConfig ?? {};
  const context = (visConfig.flowContext ?? {}) as FlowFieldContext;
  return JSON.stringify([
    config.columnMode,
    Object.entries(config.columns ?? {}).map(([key, column]) => [key, column?.value ?? null]),
    visConfig.density,
    visConfig.lineLength,
    visConfig.cycleSeconds,
    visConfig.lifeFraction,
    visConfig.smoothing,
    visConfig.elevationScale,
    context.baseMs,
    context.tallest,
    context.viewport,
  ]);
}

/**
 * The rows kepler holds, in the shape `buildWindField` reads.
 *
 * Only the columns the layer was pointed at are materialised. A velocity query
 * is normally narrow, but there is no reason to copy a column nobody reads.
 */
export function gridFrameOf(
  dataset: FlowFieldDataset,
  columns: Record<string, LayerColumn>
): GridFrame | null {
  const container = dataset.dataContainer;
  if (!container) {
    return null;
  }

  const length = container.numRows();
  const fields: GridFrame['fields'] = [];

  for (const column of Object.values(columns)) {
    const name = column?.value;
    const index = column?.fieldIdx;
    if (!name || index === undefined || index < 0) {
      continue;
    }
    const values = new Float64Array(length);
    for (let row = 0; row < length; row++) {
      values[row] = Number(container.valueAt(row, index));
    }
    fields.push({ name, values });
  }

  return { length, fields };
}

/** The grid's extent, as kepler's `[west, south, east, north]`. */
export function fieldBounds(field: WindField): [number, number, number, number] {
  return [
    field.west,
    field.south,
    field.west + (field.columns - 1) * field.stepLon,
    field.south + (field.rows - 1) * field.stepLat,
  ];
}

/** The value of a column that is the same for every row — a level's height. */
function constantOf(frame: GridFrame, column?: string | null): number {
  const field = column ? frame.fields.find((f) => f.name === column) : undefined;
  if (!field) {
    return 0;
  }
  for (let row = 0; row < frame.length; row++) {
    const value = Number(field.values[row]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

/** The speed range the traced lines span, never zero-width. */
export function speedDomainOf(lines: Streamline[]): [number, number] {
  if (lines.length === 0) {
    return [0, 1];
  }
  let min = Infinity;
  let max = -Infinity;
  for (const line of lines) {
    min = Math.min(min, line.speed);
    max = Math.max(max, line.speed);
  }
  // A field of uniform speed would otherwise divide by zero and paint every
  // line the ramp's first colour, which reads as the ramp being broken.
  return max > min ? [min, max] : [min, min + 1];
}

/** `#rrggbb` as deck's `[r, g, b]`. */
function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The colour a speed lands on, quantised over the ramp's own steps.
 *
 * Quantised rather than interpolated because that is what kepler's colour ramps
 * are: six or eight chosen colours, not two ends to blend between.
 */
export function colorForSpeed(
  colors: string[],
  domain: [number, number],
  speed: number
): [number, number, number] {
  if (colors.length === 0) {
    return [255, 255, 255];
  }
  const [min, max] = domain;
  const t = (speed - min) / (max - min);
  const index = Math.min(colors.length - 1, Math.max(0, Math.floor(t * colors.length)));
  return parseHex(colors[index]);
}

/**
 * Wraps kepler's base layer class into one that draws a velocity field.
 *
 * Extends the base layer rather than the Trip layer, even though what it
 * ultimately paints is a trips layer. The Trip layer's whole substance is
 * turning rows into paths — column modes, geojson parsing, per-row timestamps,
 * a GPU filter over the rows — and none of that describes a field, whose paths
 * exist nowhere in the data. What would be inherited is the part that has to be
 * overridden.
 */
export function makeFlowFieldLayer<C extends Constructor<object>>(
  BaseLayer: C,
  buildDeckLayer: FlowFieldDeckLayerFactory
): C {
  class FlowFieldLayer extends (BaseLayer as Constructor<FlowFieldLayerLike>) {
    constructor(props?: Record<string, unknown>) {
      super(props);
      this.registerVisConfig(FLOW_FIELD_VIS_CONFIGS as unknown as Record<string, unknown>);
    }

    get type(): string {
      return 'flowfield';
    }

    get name(): string {
      return 'Flow field';
    }

    get supportedColumnModes() {
      return FLOW_FIELD_COLUMN_MODES;
    }

    /**
     * Animatable, and with a domain of its own.
     *
     * The clock at the bottom of the map exists only for layers that say this,
     * and a velocity field without it is a still picture — which is the same as
     * a blank map, because at the start of the window every trail has zero
     * length.
     */
    getDefaultLayerConfig(props?: Record<string, unknown>): Record<string, unknown> {
      return {
        ...super.getDefaultLayerConfig(props),
        columnMode: (props?.columnMode as string) ?? 'components',
        animation: { enabled: true, domain: null },
      };
    }

    /** The window every streamline is stretched over, in epoch ms. */
    updateAnimationDomain(domain: [number, number]): void {
      const current = this.config.animation?.domain;
      if (current && current[0] === domain[0] && current[1] === domain[1]) {
        return;
      }
      this.updateLayerConfig({ animation: { ...this.config.animation, domain } });
    }

    formatLayerData(
      datasets: Record<string, FlowFieldDataset>,
      oldLayerData?: FlowFieldLayerData
    ): FlowFieldLayerData | Record<string, never> {
      const dataId = this.config.dataId;
      const dataset = dataId ? datasets?.[dataId] : undefined;
      if (!dataset) {
        return {};
      }

      const signature = traceSignature(this.config);
      const visConfig = this.config.visConfig ?? {};
      const context = (visConfig.flowContext ?? {}) as FlowFieldContext;
      const baseMs = Number(context.baseMs) || 0;
      const cycleMs = (Number(visConfig.cycleSeconds) || 60) * 1000;

      // The domain is put back even on a cache hit: it costs a comparison, and
      // getting it wrong leaves the map with a clock that runs somewhere the
      // lines do not.
      this.updateAnimationDomain([baseMs, baseMs + cycleMs]);

      if (
        oldLayerData &&
        oldLayerData.signature === signature &&
        oldLayerData.container === dataset.dataContainer
      ) {
        return oldLayerData;
      }

      const columns = this.config.columns ?? {};
      const frame = gridFrameOf(dataset, columns);
      const field = frame ? this.buildField(frame, columns, visConfig) : null;
      if (!frame || !field) {
        return { data: [], speedDomain: [0, 1], signature, container: dataset.dataContainer };
      }

      // The extent of the grid, which is the extent of everything this layer
      // can draw. Reporting it is not decoration: `centerMap` frames the map on
      // the union of its layers' bounds, and the viewport guard restores that
      // union when kepler's own view-state echo clobbers the load. A flow field
      // that keeps this to itself opens the map over kepler's default San
      // Francisco while the data sits in Ecuador — and it will, because the one
      // layer that would have known better is the Point layer this one replaces.
      this.updateMeta({ bounds: fieldBounds(field) });

      // The tracer produces its own geometry, so the altitude has to be handed
      // to it as a value. The exaggeration follows the view, because levels a
      // few kilometres apart are invisible over a region hundreds of kilometres
      // wide, and a factor that reads over a country puts the top level off the
      // screen over a city.
      const rawAltitude = constantOf(frame, columns.altitude?.value);
      const altitudeMeters =
        rawAltitude *
        stackExaggeration(Number(context.tallest) || rawAltitude, context.viewport) *
        (Number(visConfig.elevationScale) ?? 1);

      const data = traceStreamlines(field, {
        // Traced from zero rather than from `baseMs`: deck holds a vertex time
        // as a float32, which cannot tell two epoch milliseconds apart at all.
        // `renderLayer` subtracts the same base from the playhead.
        baseMs: 0,
        seed: 1,
        count: Math.round(Number(visConfig.density) || 9000),
        maxVertices: Math.round(Number(visConfig.lineLength) || 30),
        cycleMs,
        lifeFraction: Number(visConfig.lifeFraction) || 0.55,
        viewport: context.viewport,
        altitudeMeters,
      });

      return { data, speedDomain: speedDomainOf(data), signature, container: dataset.dataContainer };
    }

    /** The field the rows describe, smoothed, or null when they describe none. */
    private buildField(
      frame: GridFrame,
      columns: Record<string, LayerColumn>,
      visConfig: Record<string, unknown>
    ): WindField | null {
      const named = (key: string): string | undefined => columns[key]?.value ?? undefined;
      const latitude = named('lat');
      const longitude = named('lng');
      if (!latitude || !longitude) {
        return null;
      }

      const spec: WindFieldColumns =
        this.config.columnMode === 'polar'
          ? { latitude, longitude, speed: named('speed'), direction: named('direction') }
          : { latitude, longitude, u: named('u'), v: named('v') };

      const raw = buildWindField(frame, spec);
      if (!raw) {
        return null;
      }

      // A 0.25° grid carries detail the tracer cannot use: adjacent cells
      // disagree enough to make a particle jitter between them, and the line
      // comes out wobbly rather than flowing.
      const smoothing = Math.round(Number(visConfig.smoothing) ?? 3);
      return smoothing > 0 ? smoothWindField(raw, smoothing) : raw;
    }

    renderLayer(opts?: {
      data?: FlowFieldLayerData;
      animationConfig?: { currentTime?: number; domain?: [number, number] | null };
    }): unknown[] {
      const lines = opts?.data?.data;
      if (!lines || lines.length === 0) {
        return [];
      }

      const visConfig = this.config.visConfig ?? {};
      const cycleMs = (Number(visConfig.cycleSeconds) || 60) * 1000;
      const domain0 = this.config.animation?.domain?.[0] ?? 0;
      const currentTime = opts?.animationConfig?.currentTime;
      if (!Number.isFinite(currentTime)) {
        return [];
      }

      const colors = ((visConfig.colorRange as { colors?: string[] })?.colors ?? []) as string[];
      const speedDomain = opts?.data?.speedDomain ?? [0, 1];
      const bySpeed = visConfig.colorBySpeed !== false && colors.length > 0;
      const flat = this.config.color ?? [255, 255, 255];

      return [
        buildDeckLayer({
          id: `${this.id}-flowfield`,
          data: lines,
          // The vertices were traced from zero, so the playhead is offset by the
          // same base the domain starts at.
          currentTime: (currentTime as number) - domain0,
          trailLength: (cycleMs * (Number(visConfig.trailShare) || 4)) / 100,
          getWidth: Number(visConfig.thickness) || 2,
          opacity: Number(visConfig.opacity ?? 1),
          getColor: (line: Streamline) =>
            bySpeed ? colorForSpeed(colors, speedDomain, line.speed) : flat,
          updateTriggers: {
            getColor: [bySpeed, colors.join(','), speedDomain.join(','), flat.join(',')],
          },
        }),
      ];
    }
  }

  return FlowFieldLayer as unknown as C;
}
