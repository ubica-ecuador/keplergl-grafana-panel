import type { LayerIcon } from './cogPaintedLayer';
import { bearingOf, onDataCells, onScreenGrid } from '../data/placeSymbols';
import { shownInPane } from './paneVisibility';
import {
  buildVelocityField,
  fieldBounds,
  fieldSpeedDomain,
  FlowFieldContext,
  gridFrameOf,
  LayerColumn,
  legendDescription,
  legendPatch,
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
import { barbIconKey, barbParts, SpeedUnit, toKnots } from './windBarb';

/**
 * The kepler layer that marks a grid of velocities with arrows and wind barbs —
 * Esri's VectorFieldRenderer, where the flow field is its FlowRenderer.
 *
 * Pure, like `flowFieldLayer.ts`, and for the same reason: the base class and
 * the deck layer factory arrive as arguments, so everything that decides what is
 * drawn can be exercised with stubs. `vectorFieldDeckLayer.ts` supplies the real
 * ones.
 *
 * Built by hand rather than on kepler's own Icon layer. That one draws a row per
 * icon; here the rows are a lattice of samples and the symbols are placed on the
 * screen or on the lattice by the layer — none of them is a row.
 */

export const VECTOR_FIELD_TYPE = 'vectorfield';

/** Builds the deck layer — see `vectorFieldDeckLayer.ts`. */
export type VectorFieldDeckLayerFactory = (props: Record<string, unknown>) => unknown;

/**
 * The knobs: the ones both velocity layers share, under the same names, and this
 * layer's own.
 *
 * `smoothing` starts at 0 here where the flow field starts at 3: a symbol on a
 * data cell has to show the sample as it came, while a traced particle jitters
 * on a raw grid. `symbolSize` starts at 40 because a barb any smaller cannot be
 * read — a pennant would be two pixels high.
 */
export const VECTOR_FIELD_VIS_CONFIGS = {
  ...VELOCITY_VIS_CONFIGS,
  symbol: {
    type: 'select',
    defaultValue: 'arrow',
    options: ['arrow', 'classified', 'barb'],
    label: 'vectorfield.symbol',
    group: 'display',
    property: 'symbol',
  },
  placement: {
    type: 'select',
    defaultValue: 'screen',
    options: ['screen', 'cells'],
    label: 'vectorfield.placement',
    group: 'display',
    property: 'placement',
  },
  spacingPx: {
    type: 'number',
    defaultValue: 50,
    label: 'vectorfield.spacingPx',
    isRanged: false,
    range: [20, 200],
    step: 5,
    group: 'display',
    property: 'spacingPx',
  },
  symbolSize: {
    type: 'number',
    defaultValue: 40,
    label: 'vectorfield.symbolSize',
    isRanged: false,
    range: [8, 96],
    step: 1,
    group: 'display',
    property: 'symbolSize',
  },
  sizeBySpeed: {
    type: 'boolean',
    defaultValue: false,
    label: 'vectorfield.sizeBySpeed',
    group: 'display',
    property: 'sizeBySpeed',
  },
  sizeRange: {
    type: 'number',
    defaultValue: [12, 40],
    label: 'vectorfield.sizeRange',
    isRanged: true,
    range: [4, 96],
    step: 1,
    group: 'display',
    property: 'sizeRange',
  },
  speedUnit: {
    type: 'select',
    defaultValue: 'm/s',
    options: ['m/s', 'km/h', 'kn', 'ft/s', 'mph'],
    label: 'vectorfield.speedUnit',
    group: 'display',
    property: 'speedUnit',
  },
  smoothing: {
    type: 'number',
    defaultValue: 0,
    label: 'flowfield.smoothing',
    isRanged: false,
    range: [0, 8],
    step: 1,
    group: 'display',
    property: 'smoothing',
  },
} as const;

/** One symbol, ready to draw. */
export interface VectorSymbol {
  position: [number, number, number];
  /** In the data's own unit. */
  speed: number;
  /** Where the flow goes: degrees clockwise from north. */
  bearingTo: number;
  /** South of the equator, where a barb's feathers change side. */
  southern: boolean;
}

/** What `formatLayerData` hands back to `renderLayer`. */
export interface VectorFieldLayerData {
  /** `data`, because kepler asks `layerData.data.length` before drawing at all. */
  data: VectorSymbol[];
  speedDomain: [number, number];
  signature: string;
  container: unknown;
}

type VectorSymbolKind = 'arrow' | 'classified' | 'barb';

/** The members of kepler's base layer this subclass touches. */
interface VectorFieldLayerLike {
  id: string;
  readonly layerIcon?: unknown;
  config: {
    dataId?: string;
    columns?: Record<string, LayerColumn>;
    columnMode?: string;
    color?: [number, number, number];
    isVisible?: boolean;
    visConfig?: Record<string, unknown>;
  };
  registerVisConfig(configs: Record<string, unknown>): void;
  updateLayerConfig(patch: Record<string, unknown>): unknown;
  updateMeta(meta: Record<string, unknown>): unknown;
  getDefaultLayerConfig(props?: Record<string, unknown>): Record<string, unknown>;
  getVisualChannelDescription(key: string): { label: string; measure?: string };
}

type Constructor<T> = new (...args: any[]) => T;

/**
 * Everything that decides where the symbols go, as one string.
 *
 * The camera counts only when it changes the answer: on the screen grid, where
 * it is the answer, and whenever there is a height to exaggerate, because the
 * stack is scaled to the width of the view. Symbols sitting on the data at ground
 * level stay put while the map is panned, and the context the panel writes on
 * every settle costs a string comparison.
 */
export function symbolSignature(config: Pick<VectorFieldLayerLike['config'], 'columnMode' | 'columns' | 'visConfig'>): string {
  const visConfig = config.visConfig ?? {};
  const context = (visConfig.flowContext ?? {}) as FlowFieldContext;
  const onScreen = visConfig.placement !== 'cells';
  const lifted = Boolean(config.columns?.altitude?.value) || setting(visConfig.heightMeters, 0) > 0;
  return JSON.stringify([
    config.columnMode,
    Object.entries(config.columns ?? {}).map(([key, column]) => [key, column?.value ?? null]),
    visConfig.smoothing,
    visConfig.gradientDirection,
    visConfig.directionConvention,
    visConfig.placement,
    visConfig.spacingPx,
    visConfig.heightMeters,
    visConfig.elevationScale,
    context.tallest,
    onScreen || lifted ? context.camera : null,
  ]);
}

/** The symbol drawn: a barb only where there is a wind to count in knots. */
function kindOf(columnMode: string | undefined, symbol: unknown): VectorSymbolKind {
  if (symbol === 'barb') {
    return columnMode === 'gradient' ? 'arrow' : 'barb';
  }
  return symbol === 'classified' ? 'classified' : 'arrow';
}

export function makeVectorFieldLayer<C extends Constructor<object>>(
  BaseLayer: C,
  buildDeckLayer: VectorFieldDeckLayerFactory,
  makeCamera: ScreenCameraFactory,
  icon?: LayerIcon
): C {
  class VectorFieldLayer extends (BaseLayer as Constructor<VectorFieldLayerLike>) {
    constructor(props?: Record<string, unknown>) {
      super(props);
      this.registerVisConfig(VECTOR_FIELD_VIS_CONFIGS as unknown as Record<string, unknown>);
    }

    get layerIcon(): unknown {
      return icon ?? super.layerIcon;
    }

    get type(): string {
      return VECTOR_FIELD_TYPE;
    }

    get name(): string {
      return 'Vector field';
    }

    /** The flow field's own, so switching between the two keeps the columns. */
    get supportedColumnModes() {
      return VELOCITY_COLUMN_MODES;
    }

    getDefaultLayerConfig(props?: Record<string, unknown>): Record<string, unknown> {
      return { ...super.getDefaultLayerConfig(props), columnMode: (props?.columnMode as string) ?? 'components' };
    }

    getLegendVisualChannels() {
      return { color: VELOCITY_LEGEND_CHANNEL };
    }

    getVisualChannelDescription(key: string): { label: string; measure?: string } {
      return legendDescription(this.config as Record<string, unknown>, key) ?? super.getVisualChannelDescription(key);
    }

    private updateLegend(fieldDomain: [number, number]): void {
      const patch = legendPatch(this.config as Record<string, unknown>, fieldDomain);
      if (patch) {
        this.updateLayerConfig(patch);
      }
    }

    formatLayerData(
      datasets: Record<string, VelocityDataset>,
      oldLayerData?: VectorFieldLayerData
    ): VectorFieldLayerData | Record<string, never> {
      const dataId = this.config.dataId;
      const dataset = dataId ? datasets?.[dataId] : undefined;
      if (!dataset) {
        return {};
      }

      const signature = symbolSignature(this.config);
      if (oldLayerData && oldLayerData.signature === signature && oldLayerData.container === dataset.dataContainer) {
        this.updateLegend(oldLayerData.speedDomain);
        return oldLayerData;
      }

      const visConfig = this.config.visConfig ?? {};
      const context = (visConfig.flowContext ?? {}) as FlowFieldContext;
      const columns = this.config.columns ?? {};
      const frame = gridFrameOf(dataset, columns);
      const field = frame ? buildVelocityField(frame, columns, this.config.columnMode, visConfig, 0) : null;
      if (!frame || !field) {
        return { data: [], speedDomain: [0, 1], signature, container: dataset.dataContainer };
      }

      const speedDomain = fieldSpeedDomain(field);
      this.updateMeta({ bounds: fieldBounds(field), speedDomain });

      const camera = context.camera ? makeCamera(context.camera) : null;
      // The screen grid needs to know the screen; until the panel has said
      // where the map is looking, the data's own nodes are an honest picture.
      const placed =
        visConfig.placement !== 'cells' && camera
          ? onScreenGrid(field, camera, setting(visConfig.spacingPx, 50))
          : onDataCells(field);

      // The same stacking the flow field does, so a level drawn both ways sits
      // at one height.
      const altitude = stackedAltitude(frame, columns, visConfig, context, camera);

      const data: VectorSymbol[] = placed.map((p) => ({
        position: [p.lng, p.lat, altitude],
        speed: p.speed,
        bearingTo: bearingOf(p.u, p.v),
        southern: p.lat < 0,
      }));

      this.updateLegend(speedDomain);
      return { data, speedDomain, signature, container: dataset.dataContainer };
    }

    renderLayer(opts?: { data?: VectorFieldLayerData; visible?: boolean }): unknown[] {
      const symbols = opts?.data?.data;
      if (!symbols || symbols.length === 0) {
        return [];
      }

      const visConfig = this.config.visConfig ?? {};
      const kind = kindOf(this.config.columnMode, visConfig.symbol);
      const colors = ((visConfig.colorRange as { colors?: string[] })?.colors ?? []) as string[];
      const speedDomain = paintDomain(visConfig, opts?.data?.speedDomain ?? [0, 1]);
      const flat: [number, number, number] = this.config.color ?? [255, 255, 255];
      const colorOf = speedColorOf(visConfig, colors, flat, speedDomain);
      const unit = ((visConfig.speedUnit as SpeedUnit) ?? 'm/s') as SpeedUnit;
      const fixedSize = setting(visConfig.symbolSize, 40);
      const sizeBySpeed = visConfig.sizeBySpeed === true;
      const [smallest, largest] = rangeOf(visConfig.sizeRange) ?? [12, 40];
      // As many classes as the ramp has colours, so a class and a legend bin
      // are the same thing.
      const classes = Math.max(2, colors.length);
      const share = (s: VectorSymbol) => shareOfRange(speedDomain, s.speed);

      // Recomputed here, alongside `speedColorOf`, only because
      // `updateTriggers` needs them as cache keys.
      const bySpeed = visConfig.colorBySpeed !== false && colors.length > 0;
      const opacityBySpeed = visConfig.opacityBySpeed === true;
      const calm = Math.min(1, Math.max(0, setting(visConfig.calmOpacity, 0.2)));

      const size = (s: VectorSymbol): number => {
        if (kind === 'classified') {
          const k = Math.min(classes - 1, Math.max(0, Math.floor(share(s) * classes)));
          // Multiplied before it is divided, so a class lands exactly on its size.
          return smallest + (k * (largest - smallest)) / (classes - 1);
        }
        if (kind === 'arrow' && sizeBySpeed) {
          return smallest + share(s) * (largest - smallest);
        }
        return fixedSize;
      };

      return [
        buildDeckLayer({
          id: `${this.id}-vectorfield`,
          // Still air has no direction for an arrow to point in; a barb draws it as calm.
          data: kind === 'barb' ? symbols : symbols.filter((s) => s.speed > 0),
          visible: this.config.isVisible !== false && shownInPane(opts),
          opacity: setting(visConfig.opacity, 1),
          getIcon: (s: VectorSymbol) =>
            kind === 'barb' ? barbIconKey(barbParts(toKnots(s.speed, unit)), s.southern) : 'arrow',
          // deck turns counter-clockwise, and every glyph points north. An arrow
          // points where the flow goes; a barb's staff where the wind comes from.
          getAngle: (s: VectorSymbol) => (kind === 'barb' ? -(s.bearingTo + 180) : -s.bearingTo),
          getSize: size,
          getColor: (s: VectorSymbol) => colorOf(s.speed),
          updateTriggers: {
            getIcon: [kind, unit],
            getAngle: [kind],
            getSize: [kind, fixedSize, sizeBySpeed, smallest, largest, classes, speedDomain.join(',')],
            getColor: [bySpeed, colors.join(','), speedDomain.join(','), flat.join(','), opacityBySpeed, calm],
          },
        }),
      ];
    }
  }

  return VectorFieldLayer as unknown as C;
}
