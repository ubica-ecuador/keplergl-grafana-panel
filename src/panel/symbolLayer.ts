import { CHANNEL_SCALES } from '@kepler.gl/constants';

import { shownInPane } from './paneVisibility';
import { SYMBOL_FALLBACK, symbolNames } from './symbolGlyphs';

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

    formatLayerData(datasets: Record<string, { dataContainer?: unknown }>, oldLayerData?: unknown): Record<string, unknown> {
      const dataId = this.config.dataId;
      const dataset = dataId ? datasets?.[dataId] : undefined;
      if (!dataset) {
        return {};
      }

      const { data } = this.updateData(datasets, oldLayerData);
      // Every accessor kepler builds from the channels above, ready for deck.
      const accessors = this.getAttributeAccessors({ dataContainer: dataset.dataContainer });

      return { data, getPosition: (row: { position: unknown }) => row.position, ...accessors };
    }

    renderLayer(opts?: { data?: Record<string, unknown>; visible?: boolean }): unknown[] {
      const layerData = opts?.data;
      const rows = (layerData?.data ?? []) as unknown[];
      if (rows.length === 0) {
        return [];
      }

      const visConfig = this.config.visConfig ?? {};
      const symbol = typeof visConfig.symbol === 'string' ? visConfig.symbol : SYMBOL_FALLBACK;
      const convention = visConfig.directionConvention === 'from' ? 'from' : 'towards';
      const angleOf = layerData?.getAngle as ((row: unknown) => number) | undefined;

      const deckLayer = buildDeckLayer({
        ...this.getDefaultDeckLayerProps(opts ?? {}),
        id: `${this.id}-symbol`,
        data: rows,
        // Only the glyph in use, so the atlas stays one cell wide.
        symbols: [symbol],
        visible: this.config.isVisible !== false && shownInPane(opts),
        getPosition: layerData?.getPosition,
        getIcon: () => symbol,
        getAngle: (row: unknown) => deckAngle(Number(angleOf?.(row) ?? 0), convention),
        getSize: layerData?.getSize,
        getColor: layerData?.getColor,
        updateTriggers: {
          getIcon: [symbol],
          getAngle: [convention, visConfig.angleDegrees],
        },
      });

      // Null when the atlas could not be painted: dropping it loses this
      // layer's symbols for the frame rather than the whole map render.
      return deckLayer ? [deckLayer] : [];
    }
  }

  return SymbolLayer as unknown as C;
}
