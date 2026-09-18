import type { LayerIcon } from './cogPaintedLayer';
import type { WindField } from '../data/buildWindField';
import { Streamline, traceStreamlines } from '../data/traceStreamlines';
import { shownInPane } from './paneVisibility';
import {
  buildVelocityField,
  CameraState,
  colorForSpeed,
  fieldBounds,
  fieldSpeedDomain,
  FlowFieldContext,
  gridFrameOf,
  LayerColumn,
  latestStepOf,
  legendDescription,
  legendPatch,
  levelHeight,
  paintDomain,
  rangeOf,
  ScreenCameraFactory,
  setting,
  shareOfRange,
  speedColorOf,
  stackedAltitude,
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

/** The layer type, as a saved dashboard stores it. */
export const FLOW_FIELD_TYPE = 'flowfield';

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
 * `animate` is the switch between a field that moves and a picture of one. Off,
 * the streamlines are drawn end to end and the layer asks deck for no further
 * frames — which is also what a machine set to reduce motion gets, and what a
 * panel scrolled out of the dashboard falls back to.
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
  animate: {
    type: 'boolean',
    defaultValue: true,
    label: 'flowfield.animate',
    group: 'display',
    property: 'animate',
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
  /**
   * The forecast hour this trace is of, or null when the query carries no
   * time column — see `latestStepOf`. Not part of `signature`: the hour picks
   * *which* trace to show, it is not one of the things a trace is made of.
   */
  stepMs: number | null;
}

/**
 * One forecast hour's trace, kept so walking back to it costs nothing.
 *
 * Held per hour rather than as a single "last trace" because the map's clock
 * moves back through a forecast as often as forward through it — scrubbing a
 * timeline, or a panel simply catching up to a window that has since moved on
 * — and re-tracing on every step back is exactly the blink this exists to
 * avoid.
 */
interface HourEntry {
  field: WindField;
  speedDomain: [number, number];
  /**
   * Lines already traced, by ground cell — see `groundCells.ts`. Owned by
   * this hour: a pan within it reuses these, a pan into another hour must
   * not.
   */
  cells: Map<string, Streamline[] | null>;
  /** The whole set of lines, in the order deck draws them. */
  lines: Streamline[];
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
    /** One entry per forecast hour currently held — see `HourEntry`. */
    private _hours: Map<string, HourEntry> = new Map();
    /** The signature `_hours` was traced under — see the reset in `formatLayerData`. */
    private _hoursSignature: string | undefined;
    /** The container `_hours` was traced from — see the reset in `formatLayerData`. */
    private _hoursContainer: unknown;

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
      return FLOW_FIELD_TYPE;
    }

    // Not "Flow field": kepler 3.3.0-alpha.12 ships a Flow Field of its own, and
    // its layer menu capitalises every label, so the two read as one entry. The
    // type above is what a saved dashboard stores and stays as it is.
    get name(): string {
      return 'Streamlines';
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
     * Not animatable, deliberately.
     *
     * kepler's clock exists to say *when* — which hour of a forecast a map is
     * showing — and this layer's animation answers nothing of the sort: what
     * moves along a streamline is a trail whose speed the tracer normalises to
     * a legible number of pixels per cycle. Claiming the clock for that spent
     * the only time axis a dashboard has on a phase, merged a sixty-second
     * window into the days a WMS or a set of trips runs over, and left a paused
     * map blank. The layer keeps its own clock instead — `flowFieldClock.ts`.
     */
    getDefaultLayerConfig(props?: Record<string, unknown>): Record<string, unknown> {
      return {
        ...super.getDefaultLayerConfig(props),
        columnMode: (props?.columnMode as string) ?? 'components',
      };
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
      // Which hour the map's clock has picked — see `latestStepOf`. Deliberately
      // not folded into `signature`: the signature is what a trace is made of,
      // and the hour only says which of the hours already traced to show.
      const stepMs = latestStepOf(dataset);
      const visConfig = this.config.visConfig ?? {};
      const context = (visConfig.flowContext ?? {}) as FlowFieldContext;
      const cycleMs = setting(visConfig.cycleSeconds, 60) * 1000;

      if (
        oldLayerData &&
        oldLayerData.signature === signature &&
        oldLayerData.container === dataset.dataContainer &&
        oldLayerData.stepMs === stepMs
      ) {
        // A range set by hand is paint and keeps the trace, but the legend has
        // to follow it or it describes a ramp the map is no longer drawing.
        //
        // `stepMs` has to agree too, and not only signature and container:
        // kepler's own render loop hands this call back its own previous
        // output as `oldLayerData` on every call, not only when nothing
        // changed. Stepping the clock back an hour touches neither the
        // signature nor the dataset's `dataContainer` — only which of its rows
        // `filteredIndex` leaves standing — so without this the map would
        // read a change of hour as nothing relevant having changed at all and
        // never leave the first hour it drew.
        this.updateLegend(oldLayerData.speedDomain);
        return oldLayerData;
      }

      // Everything the hours share: the columns, the knobs, the camera. When
      // this changes, every hour on hand is stale.
      if (this._hoursSignature !== signature || this._hoursContainer !== dataset.dataContainer) {
        this._hours = new Map();
        this._hoursSignature = signature;
        this._hoursContainer = dataset.dataContainer;
      }

      // Keyed by `String(stepMs)` rather than `stepMs` itself: a dataset with
      // no time column answers `null` from `latestStepOf`, and that still
      // needs a stable entry of its own — a plain `Map` would key it by the
      // same `null` regardless, but stringifying is what makes that
      // deliberate rather than incidental.
      const held = this._hours.get(String(stepMs));
      if (held) {
        this.updateLegend(held.speedDomain);
        return { data: held.lines, speedDomain: held.speedDomain, signature, container: dataset.dataContainer, stepMs };
      }

      const columns = this.config.columns ?? {};
      const frame = gridFrameOf(dataset, columns);
      const field = frame ? buildVelocityField(frame, columns, this.config.columnMode, visConfig, 3) : null;
      if (!frame || !field) {
        return { data: [], speedDomain: [0, 1], signature, container: dataset.dataContainer, stepMs };
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
      // screen over a city. Shared with the vector field via `stackedAltitude`,
      // so a level drawn as streamlines and as arrows sits at the same height.
      const camera = context.camera ? makeCamera(context.camera) : null;
      const altitudeMeters = stackedAltitude(frame, columns, visConfig, context, camera);

      // Owned by this hour, not shared with any other: a cell seeded under
      // one hour's wind is the wrong line the moment the hour moves on, and a
      // map shared between them would leak that line into the next hour's
      // trace.
      const cells = new Map<string, Streamline[] | null>();
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
        cells,
      });

      this._hours.set(String(stepMs), { field, speedDomain, cells, lines: data });
      // Three hours: the one on show and the two drawn before it. A dashboard
      // left open on a long forecast would otherwise hold every hour it ever
      // drew.
      for (const key of [...this._hours.keys()].slice(0, Math.max(0, this._hours.size - 3))) {
        this._hours.delete(key);
      }

      this.updateLegend(speedDomain);
      return { data, speedDomain, signature, container: dataset.dataContainer, stepMs };
    }

    // No `animationConfig`: kepler passes one, and this layer has nothing to do
    // with the playhead in it — see `getDefaultLayerConfig` above.
    renderLayer(opts?: {
      data?: FlowFieldLayerData;
      /** The split map's verdict: shown in this panel, or the other one. */
      visible?: boolean;
    }): unknown[] {
      const lines = opts?.data?.data;
      if (!lines || lines.length === 0) {
        return [];
      }

      const visConfig = this.config.visConfig ?? {};
      const cycleMs = setting(visConfig.cycleSeconds, 60) * 1000;

      const colors = ((visConfig.colorRange as { colors?: string[] })?.colors ?? []) as string[];
      const speedDomain = paintDomain(visConfig, opts?.data?.speedDomain ?? [0, 1]);
      const flat: [number, number, number] = this.config.color ?? [255, 255, 255];
      const colorOf = speedColorOf(visConfig, colors, flat, speedDomain);

      // The width and the opacity follow the same range the colour does, so all
      // three agree on what counts as fast. Recomputed here, alongside
      // `speedColorOf`, only because `updateTriggers` needs them as cache keys.
      const widthBySpeed = visConfig.widthBySpeed === true;
      const [thinnest, thickest] = rangeOf(visConfig.widthRange) ?? [1, 4];
      const bySpeed = visConfig.colorBySpeed !== false && colors.length > 0;
      const opacityBySpeed = visConfig.opacityBySpeed === true;
      const calm = Math.min(1, Math.max(0, setting(visConfig.calmOpacity, 0.2)));
      const share = (line: Streamline) => shareOfRange(speedDomain, line.speed);

      return [
        buildDeckLayer({
          id: `${this.id}-flowfield`,
          data: lines,
          visible: this.config.isVisible !== false && shownInPane(opts),
          // The cycle and the trail, not a playhead: the layer runs its own
          // clock over these — see `flowFieldClock.ts`.
          cycleMs,
          trailMs: (cycleMs * setting(visConfig.trailShare, 4)) / 100,
          animate: visConfig.animate !== false,
          getWidth: widthBySpeed
            ? (line: Streamline) => thinnest + share(line) * (thickest - thinnest)
            : setting(visConfig.thickness, 2),
          opacity: setting(visConfig.opacity, 1),
          getColor: (line: Streamline) => colorOf(line.speed),
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
