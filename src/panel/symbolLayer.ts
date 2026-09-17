import { CHANNEL_SCALES } from '@kepler.gl/constants';

import { thinBySpacing } from './declutter';
import { shownInPane } from './paneVisibility';
import { setting } from './velocityField';
import { resolveSymbol, SYMBOL_FALLBACK, symbolNames } from './symbolGlyphs';

/**
 * A symbol per row, turned by one column and sized by another.
 *
 * Where the vector field marks a *grid* — its symbols are samples of a field
 * and no row of anything — this layer draws rows. That difference is what buys
 * it kepler's own machinery: the dashboard clock and the filters work on it
 * without a line of code, its channels are real columns, and a hovered symbol
 * is a row the tooltip can show.
 *
 * Pure, like the two velocity layers: the base class and the deck layer factory
 * arrive as arguments, so everything that decides what is drawn can be
 * exercised with stubs. `symbolDeckLayer.ts` supplies the real ones.
 */

export const SYMBOL_TYPE = 'symbol';

export const SYMBOL_VIS_CONFIGS = {
  opacity: 'opacity',
  colorRange: 'colorRange',
  symbol: {
    type: 'select',
    defaultValue: SYMBOL_FALLBACK,
    // A getter, not a plain array: `symbolNames()` builds the whole glyph
    // catalogue (kepler's 162 meshes triangulated into polygons among them),
    // and this object is built the moment this module is imported — by every
    // panel, whether or not a symbol layer is ever added. A getter defers that
    // cost to the one place it is actually needed: the panel reading the list
    // to draw the selector.
    get options() {
      return symbolNames();
    },
    label: 'symbol.symbol',
    group: 'display',
    property: 'symbol',
  },
  directionConvention: {
    type: 'select',
    defaultValue: 'towards',
    options: ['from', 'towards'],
    label: 'symbol.directionConvention',
    group: 'display',
    property: 'directionConvention',
  },
  angleDegrees: {
    type: 'number',
    defaultValue: 0,
    label: 'symbol.angleDegrees',
    isRanged: false,
    range: [0, 360],
    step: 1,
    group: 'display',
    property: 'angleDegrees',
  },
  symbolSize: {
    type: 'number',
    defaultValue: 30,
    label: 'symbol.symbolSize',
    isRanged: false,
    range: [8, 96],
    step: 1,
    group: 'display',
    property: 'symbolSize',
  },
  sizeRange: {
    type: 'number',
    defaultValue: [12, 48],
    label: 'symbol.sizeRange',
    isRanged: true,
    range: [4, 96],
    step: 1,
    group: 'display',
    property: 'sizeRange',
  },
  /**
   * Both switches mean the same thing to kepler and different things to a
   * reader: with `fixed` on, the channel's scale is the identity, so the
   * column's own number is used. For a bearing that is the only correct
   * reading — 270 degrees are 270 degrees — which is why it starts on.
   *
   * `fixedAngle` is registered but deliberately offered nowhere in the panel.
   * The angle channel's `fixed` key names it, so kepler reads it, and it must
   * stay on: turned off, kepler rescales the bearing onto an `angleRange` this
   * layer does not register, and d3 throws on the missing range. Nothing is
   * lost by that — a bearing rescaled onto some other span of degrees is a
   * wrong bearing, not a styling choice. See `symbolConfigurator.tsx`.
   */
  fixedAngle: {
    type: 'boolean',
    defaultValue: true,
    label: 'symbol.fixedAngle',
    group: 'display',
    property: 'fixedAngle',
  },
  fixedSize: {
    type: 'boolean',
    defaultValue: false,
    label: 'symbol.fixedSize',
    group: 'display',
    property: 'fixedSize',
  },
  declutter: {
    type: 'boolean',
    defaultValue: false,
    label: 'symbol.declutter',
    group: 'display',
    property: 'declutter',
  },
  declutterSpacingPx: {
    type: 'number',
    defaultValue: 40,
    label: 'symbol.declutterSpacingPx',
    isRanged: false,
    range: [10, 200],
    step: 5,
    group: 'display',
    property: 'declutterSpacingPx',
  },
  outline: {
    type: 'boolean',
    defaultValue: false,
    label: 'symbol.outline',
    group: 'display',
    property: 'outline',
  },
  outlineColor: {
    type: 'color-select',
    defaultValue: [255, 255, 255],
    label: 'symbol.outlineColor',
    group: 'color',
    property: 'outlineColor',
  },
  outlineThickness: {
    type: 'number',
    defaultValue: 3,
    label: 'symbol.outlineThickness',
    isRanged: false,
    range: [1, 10],
    step: 1,
    group: 'display',
    property: 'outlineThickness',
  },
  shadow: {
    type: 'boolean',
    defaultValue: false,
    label: 'symbol.shadow',
    group: 'display',
    property: 'shadow',
  },
  shadowOpacity: {
    type: 'number',
    defaultValue: 0.5,
    label: 'symbol.shadowOpacity',
    isRanged: false,
    range: [0, 1],
    step: 0.05,
    group: 'display',
    property: 'shadowOpacity',
  },
  shadowDistance: {
    type: 'number',
    defaultValue: 4,
    label: 'symbol.shadowDistance',
    isRanged: false,
    range: [0, 20],
    step: 1,
    group: 'display',
    property: 'shadowDistance',
  },
} as const;

/**
 * The angle deck must turn a glyph by, in degrees.
 *
 * deck turns counter-clockwise and every glyph points north, so the angle is
 * the negated bearing. A bearing read as *from* — the meteorological
 * convention — points the other way, half a turn round.
 */
export function deckAngle(bearing: number, convention: 'from' | 'towards'): number {
  const heading = ((bearing % 360) + 360) % 360;
  const oriented = convention === 'from' ? (heading + 180) % 360 : heading;
  // `-0` is a legal float but a broken test fixture and a confusing prop value;
  // `|| 0` folds it back to a plain zero without touching any other angle.
  return -oriented || 0;
}

/** Ground metres per screen pixel at a latitude and zoom, in Web Mercator. */
export function metresPerPixelAt(latitude: number, zoom: number): number {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * A channel's accessor as a function of the row, whatever kepler handed over.
 *
 * With a column bound, kepler's `getAttributeAccessors` builds a function; with
 * none, it hands over the channel's constant — a size, a colour — as the value
 * itself. deck accepts either, but this layer calls them per row on its own
 * account: to turn a bearing into deck's angle, and to weigh symbols against
 * each other when thinning them. Called on a constant, that was a TypeError —
 * swallowed by deck for the angle, which then drew nothing, and thrown straight
 * out of `renderLayer` for the size, into Grafana's error boundary.
 */
export function asRowAccessor<T>(value: unknown, fallback: T): (row: unknown) => T {
  if (typeof value === 'function') {
    return value as (row: unknown) => T;
  }
  const constant = value === null || value === undefined ? fallback : (value as T);
  return () => constant;
}

/**
 * The rows kepler's GPU filters would let through: every filter value within
 * its range, the test deck's filter extension applies per vertex.
 *
 * All of them when there is nothing to test against — no filter accessor, or
 * no range because the dataset has no filter.
 */
export function shownByFilters<T>(rows: T[], getFilterValue: unknown, filterRange: unknown): T[] {
  if (typeof getFilterValue !== 'function' || !Array.isArray(filterRange)) {
    return rows;
  }
  const ranges = filterRange as Array<[number, number]>;
  return rows.filter((row) => {
    const values = (getFilterValue as (row: T) => ArrayLike<number>)(row);
    return ranges.every(([low, high], i) => i >= values.length || (values[i] >= low && values[i] <= high));
  });
}

/** What a kepler dataset carries for the filters that run on the GPU. */
interface GpuFilter {
  filterValueAccessor(dataContainer: unknown): () => (row: unknown) => unknown;
  filterValueUpdateTriggers: unknown;
}

type Constructor<T> = new (...args: any[]) => T;

/** One column of a kepler layer, as kepler stores it once the config is parsed. */
interface LayerColumn {
  value?: string | null;
  fieldIdx?: number;
}

/** What a kepler data container offers the two methods below. */
interface DataContainer {
  numRows(): number;
  valueAt(row: number, column: number): unknown;
}

interface SymbolLayerLike {
  id: string;
  readonly layerIcon?: unknown;
  config: {
    dataId?: string;
    columns?: Record<string, LayerColumn>;
    color?: [number, number, number];
    isVisible?: boolean;
    visConfig?: Record<string, unknown>;
  };
  registerVisConfig(configs: Record<string, unknown>): void;
  updateData(datasets: unknown, oldLayerData?: unknown): { data: Array<{ index: number }> };
  getAttributeAccessors(args: { dataContainer: unknown }): Record<string, unknown>;
  getVisualChannelUpdateTriggers(): Record<string, Record<string, unknown>>;
  getDefaultDeckLayerProps(opts: unknown): Record<string, unknown>;
  getPointsBounds(dataContainer: unknown, getPosition?: unknown): [number, number, number, number];
  updateMeta(meta: Record<string, unknown>): unknown;
}

export function makeSymbolLayer<C extends Constructor<object>>(
  BaseLayer: C,
  buildDeckLayer: (props: Record<string, unknown>) => unknown,
  icon?: unknown
): C {
  class SymbolLayer extends (BaseLayer as Constructor<SymbolLayerLike>) {
    constructor(props?: Record<string, unknown>) {
      super(props);
      this.registerVisConfig(SYMBOL_VIS_CONFIGS as unknown as Record<string, unknown>);
    }

    get type(): string {
      return SYMBOL_TYPE;
    }

    get name(): string {
      return 'Symbols';
    }

    get layerIcon(): unknown {
      return icon ?? super.layerIcon;
    }

    get requiredLayerColumns(): string[] {
      return ['lat', 'lng'];
    }

    get optionalColumns(): string[] {
      return ['altitude'];
    }

    /**
     * Where a row sits: longitude, latitude, and the altitude column if one is
     * bound — read per row, unlike the grid layers, where a level's height is a
     * property of the whole query.
     */
    getPositionAccessor(dataContainer?: DataContainer) {
      const { lat, lng, altitude } = (this.config.columns ?? {}) as Record<string, LayerColumn>;
      // `Number(null)` is `0`, not `NaN` — a missing fix must not read as the
      // real coordinate zero, or `calculateDataAttribute`'s finite check below
      // would wave a null-island row straight through.
      const toNumber = (value: unknown): number => (value === null || value === undefined ? NaN : Number(value));
      return (row: { index: number }): [number, number, number] => [
        toNumber(dataContainer?.valueAt(row.index, lng?.fieldIdx as number)),
        toNumber(dataContainer?.valueAt(row.index, lat?.fieldIdx as number)),
        altitude && (altitude.fieldIdx ?? -1) > -1 ? toNumber(dataContainer?.valueAt(row.index, altitude.fieldIdx as number)) : 0,
      ];
    }

    /**
     * One element per row that has a position, carrying its index.
     *
     * The base class returns an empty array here on purpose — this is the
     * method a row-based layer exists to implement. The index is what makes the
     * filters and the tooltip work: kepler's `getHoverData` answers a hovered
     * object with `dataContainer.row(object.index)`.
     *
     * A row whose coordinates are not finite is dropped rather than drawn at
     * the origin, which is what kepler's own point layer does and for the same
     * reason: deck cannot place a null position, and null island is a lie.
     */
    calculateDataAttribute(
      { filteredIndex, dataContainer }: { filteredIndex?: number[]; dataContainer?: DataContainer },
      getPosition: (row: { index: number }) => [number, number, number]
    ): Array<{ position: [number, number, number]; index: number }> {
      const rows: Array<{ position: [number, number, number]; index: number }> = [];
      const indices = filteredIndex ?? Array.from({ length: dataContainer?.numRows() ?? 0 }, (_, i) => i);

      for (const index of indices) {
        const position = getPosition({ index });
        if (position.every(Number.isFinite)) {
          rows.push({ position, index });
        }
      }
      return rows;
    }

    /** The extent kepler frames the map to, measured from the rows themselves. */
    updateLayerMeta(dataset: { dataContainer?: DataContainer }): void {
      this.updateMeta({ bounds: this.getPointsBounds(dataset.dataContainer, this.getPositionAccessor(dataset.dataContainer)) });
    }

    /**
     * The three channels, with the keys kepler looks up on the config.
     *
     * `fixed` is what makes a bearing survive: with it on, `getVisChannelScale`
     * builds `linear().domain(d).range(d)` — the identity — so the column's own
     * degrees reach the glyph.
     */
    get visualChannels(): Record<string, unknown> {
      return {
        angle: {
          property: 'angle',
          field: 'angleField',
          scale: 'angleScale',
          domain: 'angleDomain',
          range: 'angleRange',
          fixed: 'fixedAngle',
          key: 'angle',
          accessor: 'getAngle',
          channelScaleType: CHANNEL_SCALES.angle,
          nullValue: 0,
          // With no column bound, kepler hands over `defaultValue` itself — and
          // an angle of 0 is falsy, which kepler reports as "Failed to provide
          // accessor function" on every data update. A function never is.
          getAttributeValue: (config: { visConfig: Record<string, unknown> }) => {
            const degrees = config.visConfig.angleDegrees ?? 0;
            return () => degrees;
          },
          // Still read by kepler: it is part of the channel's update trigger.
          defaultValue: (config: { visConfig: Record<string, unknown> }) => config.visConfig.angleDegrees ?? 0,
        },
        size: {
          property: 'size',
          field: 'sizeField',
          scale: 'sizeScale',
          domain: 'sizeDomain',
          range: 'sizeRange',
          fixed: 'fixedSize',
          key: 'size',
          accessor: 'getSize',
          channelScaleType: CHANNEL_SCALES.size,
          // A row with no size draws at the fixed size. Without a null value of
          // its own the channel falls back to kepler's no-value *colour*,
          // [0, 0, 0, 0], which deck reads as no size at all, and the symbol
          // vanishes. The same value covers `NaN`: d3's scales answer it with
          // `undefined`, which kepler replaces with this too.
          nullValue: (config: { visConfig: Record<string, unknown> }) => config.visConfig.symbolSize ?? 30,
          defaultValue: (config: { visConfig: Record<string, unknown> }) => config.visConfig.symbolSize ?? 30,
        },
        color: {
          property: 'color',
          field: 'colorField',
          scale: 'colorScale',
          domain: 'colorDomain',
          range: 'colorRange',
          key: 'color',
          accessor: 'getColor',
          channelScaleType: CHANNEL_SCALES.color,
          defaultValue: (config: { color: [number, number, number] }) => config.color,
        },
      };
    }

    formatLayerData(
      datasets: Record<string, { dataContainer?: unknown; gpuFilter?: GpuFilter }>,
      oldLayerData?: unknown
    ): Record<string, unknown> {
      const dataId = this.config.dataId;
      const dataset = dataId ? datasets?.[dataId] : undefined;
      if (!dataset) {
        return {};
      }

      const { data } = this.updateData(datasets, oldLayerData);
      // Every accessor kepler builds from the channels above, ready for deck.
      const accessors = this.getAttributeAccessors({ dataContainer: dataset.dataContainer });
      // kepler's time and range filters do not narrow the rows: they run on the
      // GPU, through the filter extension `getDefaultDeckLayerProps` attaches,
      // and that extension needs each row's value — the accessor kepler's own
      // icon and point layers hand it. Without it every row reads as the
      // domain's start, so the dashboard clock stacks every timestep or hides
      // them all. A kepler dataset always carries `gpuFilter`; the guard is for
      // a dataset built by hand.
      const getFilterValue = dataset.gpuFilter?.filterValueAccessor(dataset.dataContainer)();

      return {
        data,
        getPosition: (row: { position: unknown }) => row.position,
        ...(getFilterValue ? { getFilterValue } : {}),
        ...accessors,
      };
    }

    renderLayer(opts?: {
      data?: Record<string, unknown>;
      visible?: boolean;
      gpuFilter?: Pick<GpuFilter, 'filterValueUpdateTriggers'>;
    }): unknown[] {
      const layerData = opts?.data;
      const rows = (layerData?.data ?? []) as unknown[];
      if (rows.length === 0) {
        return [];
      }

      const visConfig = this.config.visConfig ?? {};
      // Resolved once and used twice, for the atlas and for deck's icon lookup.
      // A saved name this build lacks paints the arrow into the atlas, and deck
      // still asking for the old name finds nothing there: its empty icon.
      const symbol = resolveSymbol(visConfig.symbol);
      const convention = visConfig.directionConvention === 'from' ? 'from' : 'towards';
      const angleOf = asRowAccessor<number>(layerData?.getAngle, setting(visConfig.angleDegrees, 0));
      const sizeOf = asRowAccessor<number>(layerData?.getSize, setting(visConfig.symbolSize, 30));
      const colorOf = asRowAccessor<unknown>(layerData?.getColor, this.config.color);

      const defaults = this.getDefaultDeckLayerProps(opts ?? {});
      const getFilterValue = layerData?.getFilterValue;

      const camera = (visConfig.flowContext as { camera?: { zoom: number; latitude: number } } | undefined)?.camera;
      const metresPerPixel = camera ? metresPerPixelAt(camera.latitude, camera.zoom) : 0;
      const spacingDegrees = (setting(visConfig.declutterSpacingPx, 40) * metresPerPixel) / 111_320;
      const drawn =
        visConfig.declutter === true && spacingDegrees > 0
          ? thinBySpacing(
              // Only among the rows the filters show. They hide the rest on the
              // GPU, after this runs, so thinning every row could keep a hidden
              // one over the shown one beside it — the same station an hour
              // later, say — and the place would draw nothing at all.
              shownByFilters(
                rows as Array<{ position: [number, number, number] }>,
                getFilterValue,
                defaults.filterRange
              ),
              // Longitude is divided by the cosine of the latitude so a cell is
              // as wide as it is tall on the ground, instead of stretching
              // towards the poles.
              (row) => [
                row.position[0] * Math.max(0.2, Math.cos((row.position[1] * Math.PI) / 180)),
                row.position[1],
              ],
              spacingDegrees,
              (row) => Number(sizeOf(row))
            )
          : rows;

      // deck treats any two accessor functions as equal, and kepler hands back
      // the same row array, so a channel change reaches the GPU only through a
      // trigger: kepler's own per channel — its column, scale, domain, range
      // and constant — with this layer's reading of the angle added on top.
      const channelTriggers = this.getVisualChannelUpdateTriggers();
      const updateTriggers = {
        ...channelTriggers,
        getIcon: [symbol],
        getAngle: { ...channelTriggers.getAngle, directionConvention: convention },
        getFilterValue: opts?.gpuFilter?.filterValueUpdateTriggers,
      };

      const symbolProps = {
        ...defaults,
        id: `${this.id}-symbol`,
        data: drawn,
        // Only the glyph in use, so the atlas stays one cell wide.
        symbols: [symbol],
        visible: this.config.isVisible !== false && shownInPane(opts),
        getPosition: layerData?.getPosition,
        getIcon: () => symbol,
        getAngle: (row: unknown) => deckAngle(Number(angleOf(row) ?? 0), convention),
        getSize: sizeOf,
        getColor: colorOf,
        // Left out rather than passed as undefined when there is none, so the
        // filter extension keeps its own default instead of an empty prop.
        ...(getFilterValue ? { getFilterValue } : {}),
        updateTriggers,
      };

      // Null when an atlas could not be painted: dropping a layer loses it for
      // the frame rather than the whole map render.
      // In drawing order: the shadow under the outline, the outline under the
      // symbols.
      return [
        visConfig.shadow === true ? this.shadowOf(symbolProps, visConfig) : null,
        visConfig.outline === true ? this.outlineOf(symbolProps, visConfig) : null,
        buildDeckLayer(symbolProps),
      ].filter(Boolean);
    }

    /**
     * The symbols' outline: the same rows, angles and sizes, painted from a
     * grown copy of the glyph in one flat colour — the halo that keeps a symbol
     * legible over a base map of any colour.
     *
     * Its thickness grows with each symbol, being part of the glyph: a larger
     * symbol has a thicker outline, as a larger letter has a thicker stroke.
     */
    outlineOf(symbolProps: Record<string, any>, visConfig: Record<string, unknown>): unknown {
      const thickness = setting(visConfig.outlineThickness, 3);
      const rgb = Array.isArray(visConfig.outlineColor) ? visConfig.outlineColor.slice(0, 3) : [255, 255, 255];
      const color = [...rgb, 255];
      return buildDeckLayer({
        ...symbolProps,
        id: `${this.id}-symbol-outline`,
        outline: thickness,
        pickable: false,
        onFilteredItemsChange: undefined,
        getColor: () => color,
        updateTriggers: {
          ...symbolProps.updateTriggers,
          // A thickness is a different atlas, and a different atlas has to
          // reach the icons deck has already looked up.
          getIcon: [...symbolProps.updateTriggers.getIcon, thickness],
          getColor: color,
        },
      });
    }

    /**
     * The symbols' shadow: the same rows, angles and sizes, painted from a
     * blurred copy of the glyph in a flat dark tone and pushed a few pixels
     * down and to the right.
     *
     * The push is a constant pixel offset, and deck adds it after turning the
     * icon, so every shadow falls the same way on screen whatever each symbol's
     * bearing — the light has one direction. Not pickable, so a hover still
     * finds the symbol and the tooltip does not answer twice; and not reporting
     * filtered items, which the symbols already do.
     */
    shadowOf(symbolProps: Record<string, any>, visConfig: Record<string, unknown>): unknown {
      const alpha = Math.round(255 * Math.min(1, Math.max(0, setting(visConfig.shadowOpacity, 0.5))));
      const distance = setting(visConfig.shadowDistance, 4);
      const color = [0, 0, 0, alpha];
      return buildDeckLayer({
        ...symbolProps,
        id: `${this.id}-symbol-shadow`,
        shadow: true,
        pickable: false,
        onFilteredItemsChange: undefined,
        getColor: () => color,
        getPixelOffset: [distance, distance],
        updateTriggers: {
          ...symbolProps.updateTriggers,
          getColor: [alpha],
          getPixelOffset: [distance],
        },
      });
    }
  }

  return SymbolLayer as unknown as C;
}
