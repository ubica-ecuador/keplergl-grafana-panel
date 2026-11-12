import { CellsDeckLayer } from './cellsDeckLayer';
import { CELL_SYSTEMS } from './cellsGrid';
import { isSpacedScale, SPACED_SCALES, spacedScale } from './cellsScales';

/** '#rrggbb' to [r, g, b], as kepler's colour ranges are turned into scale ranges. */
function hexToRgb(hex: string): number[] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const CELLS_TYPE = 'cells';

export const CELLS_VIS_CONFIGS: Record<string, unknown> = {
  cellSystem: {
    type: 'select',
    defaultValue: 'h3',
    options: CELL_SYSTEMS,
    label: 'cells.system',
    description: 'cells.system.hint',
    group: 'display',
    property: 'cellSystem',
  },
  cellPixels: {
    type: 'number',
    defaultValue: 36,
    label: 'cells.size',
    description: 'cells.size.hint',
    isRanged: false,
    range: [8, 160],
    step: 1,
    group: 'display',
    property: 'cellPixels',
  },
  cellTransition: {
    type: 'number',
    defaultValue: 400,
    label: 'cells.transition',
    description: 'cells.transition.hint',
    isRanged: false,
    range: [0, 2000],
    step: 50,
    group: 'display',
    property: 'cellTransition',
  },
  cellDensity: {
    type: 'boolean',
    defaultValue: false,
    label: 'cells.density',
    description: 'cells.density.hint',
    group: 'display',
    property: 'cellDensity',
  },
};

type Constructor<T> = new (...args: any[]) => T;

interface HexbinLike {
  id: string;
  config: Record<string, any>;
  visConfigSettings: Record<string, Record<string, unknown>>;
  registerVisConfig(configs: Record<string, unknown>): void;
  noneLayerDataAffectingProps: string[];
  formatLayerData(datasets: Record<string, any>, oldLayerData: unknown, opt?: unknown): Record<string, any>;
  getDefaultAggregationLayerProp(opts: unknown): Record<string, any>;
  getCountLabelProps(opts: unknown): Record<string, any>;
  getScaleOptions(channel: string): string[];
  getColorScale(colorScale: string, colorDomain: unknown, colorRange: unknown): unknown;
}

/**
 * The Cells layer, over kepler's Hexbin: the same columns, colour and height channels, aggregations, legend, count
 * labels and filters, with the hexagons of a fixed radius replaced by the cells of a global grid whose level follows
 * the zoom (cellsDeckLayer.ts). The Hexbin's Radius slider sets the cells' size on screen instead.
 *
 * kepler's H3 layer, its S2, A5 and geohash layers draw cells whose ids are already in the data, at one level; its
 * Hexbin draws hexagons of a fixed radius in kilometres with no id. This one gives every point its cell and picks the
 * level from the zoom, so the map refines as you zoom in, and keeps the Hexbin's aggregation and legend.
 */
export function makeCellsLayer<C>(Base: C, icon: unknown): C {
  class CellsLayer extends (Base as unknown as Constructor<HexbinLike>) {
    constructor(props?: Record<string, unknown>) {
      super(props);
      this.registerVisConfig(CELLS_VIS_CONFIGS);
      // kepler's aggregation panel draws the Radius group from `worldUnitSize`: here it is the cell size in pixels.
      this.visConfigSettings.worldUnitSize = this.visConfigSettings.cellPixels;
    }

    get type(): string {
      return CELLS_TYPE;
    }

    get name(): string {
      return 'Cells';
    }

    get layerIcon() {
      return icon;
    }

    /** Claims no dataset: a Cells layer exists only when the user, or a saved map, makes one. */
    static findDefaultLayerProps(): { props: Array<Record<string, unknown>> } {
      return { props: [] };
    }

    /** The grid, the size and density change the drawing, not kepler's rows. */
    get noneLayerDataAffectingProps(): string[] {
      return [...super.noneLayerDataAffectingProps, 'cellSystem', 'cellPixels', 'cellDensity', 'cellTransition'];
    }

    /** The Hexbin's colour scales, then Log and Sqrt: cells of counts run from a few to thousands (scales.ts). */
    getScaleOptions(channel: string): string[] {
      const options = super.getScaleOptions(channel);
      if (channel !== 'color' || options.length === 0 || options.includes('ordinal')) {
        return options;
      }
      return [...options, ...SPACED_SCALES.filter((type) => !options.includes(type))];
    }

    /** Log and Sqrt as classes on that axis, which kepler's legend draws like any threshold scale. */
    getColorScale(colorScale: string, colorDomain: unknown, colorRange: unknown): unknown {
      if (isSpacedScale(colorScale) && Array.isArray(colorDomain)) {
        const colours = ((colorRange as { colors?: string[] })?.colors ?? []).map(hexToRgb);
        return spacedScale(colorScale, colorDomain as number[], colours);
      }
      return super.getColorScale(colorScale, colorDomain, colorRange);
    }

    /** The Hexbin's data plus the dataset's container, which keeps each row's cell while the data is the same. */
    formatLayerData(datasets: Record<string, any>, oldLayerData: unknown, opt?: unknown): Record<string, any> {
      const base = super.formatLayerData(datasets, oldLayerData, opt);
      return { ...base, cellSource: datasets?.[this.config.dataId]?.dataContainer };
    }

    renderLayer(opts: { data: Record<string, any> }) {
      const visConfig = this.config.visConfig ?? {};
      return [
        new CellsDeckLayer({
          ...this.getDefaultAggregationLayerProp(opts),
          ...opts.data,
          ...this.getCountLabelProps(opts),
          wrapLongitude: false,
          cellSystem: visConfig.cellSystem,
          cellPixels: visConfig.cellPixels,
          cellDensity: visConfig.cellDensity,
          cellTransition: visConfig.cellTransition,
          cellColorScale: this.config.colorScale,
          // The scale the legend draws, so the cells and the legend agree on every scale type.
          colorScaleOf: (type: string, domain: number[]) =>
            this.getColorScale(type, domain, visConfig.colorRange) as ((value: number) => unknown) | null,
        } as never),
      ];
    }
  }
  return CellsLayer as unknown as C;
}
