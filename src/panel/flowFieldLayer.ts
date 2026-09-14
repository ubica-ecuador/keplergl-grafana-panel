import type { LayerIcon } from './cogPaintedLayer';
import { stackExaggeration, Streamline, traceStreamlines } from '../data/traceStreamlines';
import { shownInPane } from './paneVisibility';
import {
  buildVelocityField,
  CameraState,
  colorForSpeed,
  constantOf,
  fieldBounds,
  fieldSpeedDomain,
  FlowFieldContext,
  gridFrameOf,
  LayerColumn,
  legendDescription,
  legendPatch,
  levelHeight,
  paintDomain,
  rangeOf,
  ScreenCameraFactory,
  setting,
  shareOfRange,
  VelocityDataset,
  VELOCITY_COLUMN_MODES,
  VELOCITY_LEGEND_CHANNEL,
  VELOCITY_VIS_CONFIGS,
} from './velocityField';

// Re-exported so the modules and tests that import these from here keep working.
export { colorForSpeed, fieldBounds, fieldSpeedDomain, gridFrameOf, levelHeight, paintDomain, setting };
export type { CameraState, FlowFieldContext, ScreenCameraFactory };
export type FlowFieldDataset = VelocityDataset;
export const FLOW_FIELD_COLUMN_MODES = VELOCITY_COLUMN_MODES;

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
 * The knobs, and their defaults.
 *
 * The defaults are the constants this layer replaced, so a map that was drawn
 * before any of this existed comes back looking the same. Two of them earn a
 * word:
 *
 * `zoomResponse` decides what the line count is a budget *for*. At 0 it is a
 * budget for the screen, so the field looks the same at every scale — Esri's
 * model, and what this drew before the knob existed. At 1 it is a budget for the
 * whole field, so zooming in shows only the share of it that is on screen and
 * the lines separate, which is what a person means by zooming into something.
 *
 * `heightMeters` and `elevationScale` are not two spellings of the same thing, and the difference
 * is worth stating because the first looks inert on its own. The automatic
 * exaggeration normalises the **tallest level on the map** to a share of the
 * view, so with a single layer the metres decide only whether it is on the
 * ground or lifted — how *high* it is drawn is `elevationScale`. The metres earn
 * their keep the moment there is a second level: they are what puts 850 hPa and
 * 700 hPa in their real proportion to each other.
 *
 * `cycleSeconds` runs every streamline over one shared window, so the whole
 * field is on screen at all times and what moves is a short trail — the
 * earth.nullschool look. `lifeFraction` is how much of that window one line
 * lives for, and so how much of the field is lit at once.
 *
 * `seamlessLoop` is what makes `lifeFraction` mean only that. Without it a line
 * has to end before the cycle does, so none is born in the window's last
 * stretch and none has been alive long at its start: the field measurably
 * empties into the loop and refills out of it — nothing alive at either end,
 * everything alive in the middle. With it, a line that overruns is drawn a
 * second time a cycle earlier and carries straight across the seam. The cost is
 * that second drawing: about half again as many lines at the default lifetime,
 * and nearly double at a lifetime of 1.
 *
 * The trail is a **share of the cycle** rather than kepler's own `trailLength`,
 * which is an absolute number with a default of 180. The vertex times here are
 * milliseconds spanning a sixty-second window, so that default is three tenths
 * of one percent of the animation: every streamline draws as a dot, and the map
 * looks like static rather than flow. Expressed as a share, the look also
 * survives a change of cycle instead of having to be retuned after it.
 */
export const FLOW_FIELD_VIS_CONFIGS = {
  ...VELOCITY_VIS_CONFIGS,
  thickness: 'thickness',
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
  seamlessLoop: {
    type: 'boolean',
    defaultValue: true,
    label: 'flowfield.seamlessLoop',
    group: 'display',
    property: 'seamlessLoop',
  },
  zoomResponse: {
    type: 'number',
    defaultValue: 0,
    label: 'flowfield.zoomResponse',
    isRanged: false,
    range: [0, 1],
    step: 0.05,
    group: 'display',
    property: 'zoomResponse',
  },
  /**
   * Width and opacity following speed, Esri's size and opacity variables.
   *
   * Both per line, from the line's mean speed, because deck draws a path at one
   * width. Both off by default, so a map drawn before they existed comes back
   * the same. The calm end of the opacity is a knob rather than zero: a field
   * whose slack air vanishes entirely reads as holes in the data.
   */
  widthBySpeed: {
    type: 'boolean',
    defaultValue: false,
    label: 'flowfield.widthBySpeed',
    group: 'stroke',
    property: 'widthBySpeed',
  },
  widthRange: {
    type: 'number',
    defaultValue: [1, 4],
    label: 'flowfield.widthRange',
    isRanged: true,
    range: [0, 20],
    step: 0.5,
    group: 'stroke',
    property: 'widthRange',
  },
} as const;

/** The members of kepler's base layer this subclass touches. */
interface FlowFieldLayerLike {
  id: string;
  /** kepler's placeholder, when the factory was handed no icon of its own. */
  readonly layerIcon?: unknown;
  config: {
    dataId?: string;
    columns?: Record<string, LayerColumn>;
    columnMode?: string;
    color?: [number, number, number];
    isVisible?: boolean;
    animation?: { enabled?: boolean; domain?: [number, number] | null };
    visConfig?: Record<string, unknown>;
  };
  registerVisConfig(configs: Record<string, unknown>): void;
  updateLayerConfig(patch: Record<string, unknown>): unknown;
  updateMeta(meta: Record<string, unknown>): unknown;
  getDefaultLayerConfig(props?: Record<string, unknown>): Record<string, unknown>;
  getVisualChannelDescription(key: string): { label: string; measure?: string };
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
  /**
   * The speed range of the whole field — what the colour ramp is stretched over
   * unless a range is set by hand. Taken from the field and not from the lines,
   * because the lines follow the camera.
   */
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
    visConfig.seamlessLoop,
    visConfig.smoothing,
    visConfig.gradientDirection,
    visConfig.directionConvention,
    visConfig.heightMeters,
    visConfig.elevationScale,
    visConfig.zoomResponse,
    context.baseMs,
    context.tallest,
    context.camera,
  ]);
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
  buildDeckLayer: FlowFieldDeckLayerFactory,
  makeCamera: ScreenCameraFactory,
  icon?: LayerIcon
): C {
  class FlowFieldLayer extends (BaseLayer as Constructor<FlowFieldLayerLike>) {
    constructor(props?: Record<string, unknown>) {
      super(props);
      this.registerVisConfig(FLOW_FIELD_VIS_CONFIGS as unknown as Record<string, unknown>);
    }

    get layerIcon(): unknown {
      // Left to the base class when none was handed in, rather than reported as
      // undefined: kepler draws a placeholder for a layer with no icon, and an
      // undefined one would leave a blank where that should be.
      return icon ?? super.layerIcon;
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

    /** See `VELOCITY_LEGEND_CHANNEL`. */
    getLegendVisualChannels() {
      return { color: VELOCITY_LEGEND_CHANNEL };
    }

    /**
     * What the colour is a measure of, which is what switches kepler's legend
     * from a single swatch to a ramp. No measure while the lines are one colour.
     */
    getVisualChannelDescription(key: string): { label: string; measure?: string } {
      return legendDescription(this.config as Record<string, unknown>, key) ?? super.getVisualChannelDescription(key);
    }

    /** Writes the legend's keys, and only when one of them changed — see `legendPatch`. */
    private updateLegend(fieldDomain: [number, number]): void {
      const patch = legendPatch(this.config as Record<string, unknown>, fieldDomain);
      if (patch) {
        this.updateLayerConfig(patch);
      }
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
      const baseMs = setting(context.baseMs, 0);
      const cycleMs = setting(visConfig.cycleSeconds, 60) * 1000;

      // The domain is put back even on a cache hit: it costs a comparison, and
      // getting it wrong leaves the map with a clock that runs somewhere the
      // lines do not.
      this.updateAnimationDomain([baseMs, baseMs + cycleMs]);

      if (
        oldLayerData &&
        oldLayerData.signature === signature &&
        oldLayerData.container === dataset.dataContainer
      ) {
        // A range set by hand is paint and keeps the trace, but the legend has
        // to follow it or it describes a ramp the map is no longer drawing.
        this.updateLegend(oldLayerData.speedDomain);
        return oldLayerData;
      }

      const columns = this.config.columns ?? {};
      const frame = gridFrameOf(dataset, columns);
      const field = frame ? buildVelocityField(frame, columns, this.config.columnMode, visConfig, 3) : null;
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
      //
      // The field's speed range rides along for the panel, which starts a range
      // set by hand from it and sizes that range's slider to it.
      const speedDomain = fieldSpeedDomain(field);
      this.updateMeta({ bounds: fieldBounds(field), speedDomain });

      // The tracer produces its own geometry, so the altitude has to be handed
      // to it as a value. The exaggeration follows the view, because levels a
      // few kilometres apart are invisible over a region hundreds of kilometres
      // wide, and a factor that reads over a country puts the top level off the
      // screen over a city.
      const rawAltitude = levelHeight(
        columns.altitude?.value,
        constantOf(frame, columns.altitude?.value),
        visConfig
      );
      const camera = context.camera ? makeCamera(context.camera) : null;
      // How wide the view is across its middle, which is what a person means by
      // it — and unlike the ground the camera can see, it does not balloon when
      // the map is tilted.
      const metresAcross = camera ? camera.metresPerPixel * camera.widthPx : undefined;
      const altitudeMeters =
        rawAltitude *
        stackExaggeration(setting(context.tallest, rawAltitude), metresAcross) *
        setting(visConfig.elevationScale, 1);

      const data = traceStreamlines(field, {
        // Traced from zero rather than from `baseMs`: deck holds a vertex time
        // as a float32, which cannot tell two epoch milliseconds apart at all.
        // `renderLayer` subtracts the same base from the playhead.
        baseMs: 0,
        seed: 1,
        count: Math.round(setting(visConfig.density, 9000)),
        maxVertices: Math.round(setting(visConfig.lineLength, 30)),
        cycleMs,
        lifeFraction: setting(visConfig.lifeFraction, 0.55),
        seamless: visConfig.seamlessLoop !== false,
        camera: camera ?? undefined,
        zoomResponse: setting(visConfig.zoomResponse, 0),
        altitudeMeters,
      });

      this.updateLegend(speedDomain);
      return { data, speedDomain, signature, container: dataset.dataContainer };
    }

    renderLayer(opts?: {
      data?: FlowFieldLayerData;
      animationConfig?: { currentTime?: number; domain?: [number, number] | null };
      /** The split map's verdict: shown in this panel, or the other one. */
      visible?: boolean;
    }): unknown[] {
      const lines = opts?.data?.data;
      if (!lines || lines.length === 0) {
        return [];
      }

      const visConfig = this.config.visConfig ?? {};
      const cycleMs = setting(visConfig.cycleSeconds, 60) * 1000;
      const domain0 = this.config.animation?.domain?.[0] ?? 0;
      const currentTime = opts?.animationConfig?.currentTime;
      if (!Number.isFinite(currentTime)) {
        return [];
      }

      const colors = ((visConfig.colorRange as { colors?: string[] })?.colors ?? []) as string[];
      const speedDomain = paintDomain(visConfig, opts?.data?.speedDomain ?? [0, 1]);
      const bySpeed = visConfig.colorBySpeed !== false && colors.length > 0;
      const flat = this.config.color ?? [255, 255, 255];

      // The width and the opacity follow the same range the colour does, so all
      // three agree on what counts as fast.
      const widthBySpeed = visConfig.widthBySpeed === true;
      const [thinnest, thickest] = rangeOf(visConfig.widthRange) ?? [1, 4];
      const opacityBySpeed = visConfig.opacityBySpeed === true;
      const calm = Math.min(1, Math.max(0, setting(visConfig.calmOpacity, 0.2)));
      const share = (line: Streamline) => shareOfRange(speedDomain, line.speed);

      return [
        buildDeckLayer({
          id: `${this.id}-flowfield`,
          data: lines,
          visible: this.config.isVisible !== false && shownInPane(opts),
          // The vertices were traced from zero, so the playhead is offset by the
          // same base the domain starts at.
          currentTime: (currentTime as number) - domain0,
          trailLength: (cycleMs * setting(visConfig.trailShare, 4)) / 100,
          getWidth: widthBySpeed
            ? (line: Streamline) => thinnest + share(line) * (thickest - thinnest)
            : setting(visConfig.thickness, 2),
          opacity: setting(visConfig.opacity, 1),
          getColor: (line: Streamline) => {
            const rgb = bySpeed ? colorForSpeed(colors, speedDomain, line.speed) : flat;
            // The alpha rides in the colour because the trail fades by
            // multiplying it: the slack lines fade along with their trails.
            return opacityBySpeed ? [...rgb, Math.round(255 * (calm + share(line) * (1 - calm)))] : rgb;
          },
          updateTriggers: {
            getColor: [bySpeed, colors.join(','), speedDomain.join(','), flat.join(','), opacityBySpeed, calm],
            getWidth: [widthBySpeed, thinnest, thickest, speedDomain.join(',')],
          },
        }),
      ];
    }
  }

  return FlowFieldLayer as unknown as C;
}
