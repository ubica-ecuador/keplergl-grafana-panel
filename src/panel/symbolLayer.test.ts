import {
  deckAngle,
  makeSymbolLayer,
  metresPerPixelAt,
  shownByFilters,
  SYMBOL_TYPE,
  SYMBOL_VIS_CONFIGS,
} from './symbolLayer';

/** A stand-in for kepler's base Layer, with only what the subclass touches. */
class FakeBaseLayer {
  id = 'layer-1';
  config: Record<string, any> = { visConfig: {} };
  visConfigSettings: Record<string, unknown> = {};
  meta: Record<string, unknown> = {};

  constructor(props?: Record<string, unknown>) {
    this.config = { ...this.getDefaultLayerConfig(props), ...props, visConfig: {} };
  }

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

  /**
   * kepler's own, narrowed: it asks the subclass for the rows.
   *
   * Written this way rather than returning canned rows so the test exercises
   * `getPositionAccessor` and `calculateDataAttribute` — the two methods the
   * base class leaves empty, and without which the layer draws nothing.
   */
  updateData(datasets: Record<string, { dataContainer: any }>): { data: unknown[] } {
    const dataContainer = datasets[this.config.dataId].dataContainer;
    return {
      data: (this as any).calculateDataAttribute(
        { dataContainer },
        (this as any).getPositionAccessor(dataContainer)
      ),
    };
  }

  getPointsBounds(): [number, number, number, number] {
    return [-79, -2, -78, -1];
  }

  /** kepler builds these from `visualChannels`; here they are stubs that record. */
  getAttributeAccessors(): Record<string, unknown> {
    return { getAngle: () => 90, getSize: () => 20, getColor: () => [1, 2, 3] };
  }

  /**
   * kepler derives these from `visualChannels` too. Empty here: what they hold
   * is kepler's business, and `symbolLayer.kepler.test.ts` checks them on the
   * real class — this stand-in is not the place to pin kepler's behaviour.
   */
  getVisualChannelUpdateTriggers(): Record<string, Record<string, unknown>> {
    return {};
  }

  getDefaultDeckLayerProps(): Record<string, unknown> {
    return { id: this.id, pickable: true };
  }

  renderTextLabelLayer(): unknown[] {
    return [];
  }
}

/**
 * Three stations, the third with no longitude — an ordinary result, not an
 * edge case: a station that reported no fix.
 */
const threeStations = {
  dataContainer: {
    numRows: () => 3,
    valueAt: (row: number, column: number) => [[-79, -2], [-78, -1], [null, -3]][row][column],
  },
};

/** `lng` is column 0 and `lat` column 1, as the fake container above stores them. */
const stationColumns = { lng: { value: 'longitude', fieldIdx: 0 }, lat: { value: 'latitude', fieldIdx: 1 } };

const built: Array<Record<string, any>> = [];
const fakeBuild = (props: Record<string, unknown>) => {
  built.push(props);
  return { props };
};

const SymbolLayer = makeSymbolLayer(FakeBaseLayer as never, fakeBuild);

beforeEach(() => {
  built.length = 0;
});

describe('deckAngle', () => {
  it('turns a bearing the flow goes towards into deck’s counter-clockwise angle', () => {
    // Every glyph points north; deck turns counter-clockwise.
    expect(deckAngle(90, 'towards')).toBe(-90);
    expect(deckAngle(0, 'towards')).toBe(0);
  });

  it('spins a bearing the wind comes from by half a turn', () => {
    // A north wind blows southwards: the arrow must point south.
    expect(deckAngle(0, 'from')).toBe(-180);
  });

  it('normalises whatever the column holds', () => {
    // -90 and 270 are the same bearing; 720 is none at all.
    expect(deckAngle(-90, 'towards')).toBe(deckAngle(270, 'towards'));
    expect(deckAngle(720, 'towards')).toBe(0);
  });
});

describe('metresPerPixelAt', () => {
  it('halves with every zoom level', () => {
    expect(metresPerPixelAt(0, 1)).toBeCloseTo(metresPerPixelAt(0, 0) / 2, 6);
  });

  it('shrinks away from the equator', () => {
    expect(metresPerPixelAt(60, 10)).toBeCloseTo(metresPerPixelAt(0, 10) / 2, 2);
  });
});

describe('symbol layer', () => {
  it('is its own type and registers the knobs the panel offers', () => {
    const layer = new (SymbolLayer as never as new (props?: Record<string, unknown>) => any)({});

    expect(layer.type).toBe(SYMBOL_TYPE);
    expect(Object.keys(SYMBOL_VIS_CONFIGS)).toEqual(
      expect.arrayContaining(['symbol', 'directionConvention', 'angleDegrees', 'symbolSize', 'fixedAngle', 'fixedSize'])
    );
  });

  it('reads degrees straight through: the fixed-angle switch is on by default', () => {
    const layer = new (SymbolLayer as never as new (props?: Record<string, unknown>) => any)({});

    // Without it kepler rescales the bearing onto the channel's range and the
    // rotation comes out plausible and wrong.
    expect(layer.config.visConfig.fixedAngle).toBe(true);
  });

  it('declares the three channels with the keys kepler looks up', () => {
    const layer = new (SymbolLayer as never as new (props?: Record<string, unknown>) => any)({});

    expect(layer.visualChannels.angle).toMatchObject({
      field: 'angleField',
      scale: 'angleScale',
      domain: 'angleDomain',
      range: 'angleRange',
      fixed: 'fixedAngle',
      accessor: 'getAngle',
      key: 'angle',
    });
    expect(layer.visualChannels.size).toMatchObject({ field: 'sizeField', accessor: 'getSize' });
    expect(layer.visualChannels.color).toMatchObject({ field: 'colorField', accessor: 'getColor' });
  });

  const symbolLayer = (Factory = SymbolLayer) =>
    new (Factory as never as new (props?: Record<string, unknown>) => any)({ dataId: 'd1', columns: stationColumns });

  it('hands every row its index, which is what makes the tooltip work', () => {
    const layer = symbolLayer();

    const data = layer.formatLayerData({ d1: threeStations });

    expect(data.data.map((row: { index: number }) => row.index)).toEqual([0, 1]);
    expect(data.data[0].position).toEqual([-79, -2, 0]);
    expect(data.getAngle).toBeDefined();
  });

  it('drops a row with no position rather than drawing it at null island', () => {
    const layer = symbolLayer();

    // The third station reported no longitude. deck cannot place a null
    // position, and [0, 0] is a lie off the coast of Ghana.
    expect(layer.formatLayerData({ d1: threeStations }).data).toHaveLength(2);
  });

  it('passes the chosen symbol to the deck layer, so the atlas paints only that one', () => {
    const layer = symbolLayer();
    layer.updateLayerConfig({ visConfig: { ...layer.config.visConfig, symbol: 'airport' } });

    layer.renderLayer({ data: layer.formatLayerData({ d1: threeStations }) });

    expect(built[0].symbols).toEqual(['airport']);
    expect(built[0].getIcon({})).toBe('airport');
    expect(built[0].pickable).toBe(true);
  });

  it('draws nothing rather than taking the map down when the atlas cannot be painted', () => {
    const NullLayer = makeSymbolLayer(FakeBaseLayer as never, () => null);
    const layer = symbolLayer(NullLayer);

    expect(layer.renderLayer({ data: layer.formatLayerData({ d1: threeStations }) })).toEqual([]);
  });

  it('asks for no deck layer at all when the query returned nothing', () => {
    // An empty result is ordinary — a query waiting on a variable nobody set.
    const empty = { dataContainer: { numRows: () => 0, valueAt: () => null } };
    const layer = symbolLayer();

    expect(layer.renderLayer({ data: layer.formatLayerData({ d1: empty }) })).toEqual([]);
    expect(built).toHaveLength(0);
  });

  it('builds nothing when the layer points at a dataset that is not there', () => {
    expect(symbolLayer().formatLayerData({})).toEqual({});
  });
});

describe('import-time cost', () => {
  /**
   * `keplerStore.ts` imports this module on every panel render, whether or
   * not a symbol layer is ever added. A regression here — the glyph catalogue
   * built as a side effect of importing rather than of actually reading the
   * panel's option list — once cost this branch two fix rounds for the
   * vector field layer's own version of the same mistake (commit 273a116).
   *
   * `../icons/svg-icons.json` is what `symbolGlyphs.ts`'s catalogue reads to
   * triangulate kepler's 162 meshes; mocking it with a getter turns "was the
   * catalogue built" into an observable without needing to reach into
   * `symbolGlyphs.ts`'s own module-private cache.
   */
  it('does not build the glyph catalogue merely by importing the layer, only by reading the panel options', () => {
    let readSvgIcons = false;

    jest.isolateModules(() => {
      jest.doMock('../icons/svg-icons.json', () => {
        const actual = jest.requireActual('../icons/svg-icons.json');
        return {
          get svgIcons() {
            readSvgIcons = true;
            return actual.svgIcons;
          },
        };
      });

      // A plain `require`, not the file's top-level `import`: this needs to
      // run after the mock above is registered, inside the isolated registry.
      require('./symbolLayer');
      expect(readSvgIcons).toBe(false);

      const { SYMBOL_VIS_CONFIGS: freshConfigs } = require('./symbolLayer');
      expect((freshConfigs.symbol.options as string[]).length).toBeGreaterThan(0);
      expect(readSvgIcons).toBe(true);
    });
  });
});

describe('shownByFilters', () => {
  const rows = [{ t: 1 }, { t: 5 }, { t: 9 }];
  const getFilterValue = (row: { t: number }) => [row.t, 0];

  it('keeps the rows whose every filter value lies within its range', () => {
    expect(shownByFilters(rows, getFilterValue, [[0, 6], [0, 0]])).toEqual([{ t: 1 }, { t: 5 }]);
  });

  it('keeps every row when there is no filter to test against', () => {
    expect(shownByFilters(rows, undefined, [[0, 6]])).toBe(rows);
    expect(shownByFilters(rows, getFilterValue, undefined)).toBe(rows);
  });
});
