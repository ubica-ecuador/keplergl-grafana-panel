import { esriDeckProps, makeEsriImageLayer, EsriImageMetadata } from './esriImageLayer';

const SERVICE = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer';

const RULE_2023 = '{"mosaicMethod":"esriMosaicAttribute","where":"Year=2023"}';
const RULE_2017 = '{"mosaicMethod":"esriMosaicAttribute","where":"Year=2017"}';

const META: EsriImageMetadata = { serviceUrl: SERVICE, mosaicRule: RULE_2023 };

const TILE = { west: -81.5625, south: -2.811371, east: -80.15625, north: -1.406109 };

describe('esriDeckProps', () => {
  it('hands deck a way to build the url of any tile', () => {
    const props = esriDeckProps({ id: 'layer-1', metadata: META });
    const url = (props?.getTileUrl as (b: typeof TILE) => string | null)(TILE);

    expect(url).toContain('/exportImage?');
    expect(url).toContain('bboxSR=3857');
  });

  it('puts the mosaic rule in updateTriggers, not only in the url', () => {
    // The lesson PMTiles taught this repo: deck serves the tiles it fetched
    // first unless a trigger it watches changes. The rule is how the year is
    // chosen, so without this every year would draw the first one — and the
    // requests would look perfectly healthy while doing it.
    const first = esriDeckProps({ id: 'layer-1', metadata: META });
    const second = esriDeckProps({ id: 'layer-1', metadata: { ...META, mosaicRule: RULE_2017 } });

    const triggerOf = (props: Record<string, unknown> | null) =>
      (props?.updateTriggers as { getTileData?: unknown })?.getTileData;

    expect(triggerOf(first)).toBeDefined();
    expect(triggerOf(first)).not.toEqual(triggerOf(second));
  });

  it('draws nothing when there is no metadata yet', () => {
    expect(esriDeckProps({ id: 'layer-1', metadata: undefined })).toBeNull();
  });

  it('draws nothing when the query named no service', () => {
    expect(esriDeckProps({ id: 'layer-1', metadata: { serviceUrl: '  ' } })).toBeNull();
  });

  it('carries the opacity kepler settled on', () => {
    expect(esriDeckProps({ id: 'layer-1', metadata: META, opacity: 0.4 })?.opacity).toBe(0.4);
  });

  it('names the deck layer after the kepler layer it belongs to', () => {
    expect(esriDeckProps({ id: 'layer-1', metadata: META })?.id).toContain('layer-1');
  });
});

/** A stand-in for kepler's base Layer, with only what the subclass touches. */
class FakeBaseLayer {
  config: { visConfig: Record<string, unknown>; isVisible?: boolean; dataId?: string } = {
    visConfig: {},
    isVisible: true,
  };
  id = 'layer-1';
  /** What the subclass asked kepler to put in the layer panel. */
  visConfigSettings: Record<string, unknown> = {};
  constructor(_props?: unknown) {}

  /**
   * kepler's own contract, reproduced: a layer declares the controls it wants
   * and the base class turns each into a panel entry with its default.
   */
  registerVisConfig(configs: Record<string, string>) {
    for (const [key, preset] of Object.entries(configs)) {
      this.visConfigSettings[key] = { preset };
    }
  }

  /** kepler's own verdict: a layer holding no rows is judged unrenderable. */
  shouldRenderLayer(_data?: unknown): boolean {
    return false;
  }
}

const built: Array<Record<string, unknown>> = [];
const fakeBuild = (props: Record<string, unknown>) => {
  built.push(props);
  return { props };
};

describe('makeEsriImageLayer', () => {
  const EsriLayer = makeEsriImageLayer(FakeBaseLayer, fakeBuild);
  const make = () => new (EsriLayer as never as new (p?: unknown) => any)();

  beforeEach(() => {
    built.length = 0;
  });

  it('answers to the type the dataset asks for', () => {
    expect(make().type).toBe('esriImage');
  });

  it('registers an opacity setting, the half of the control it owns', () => {
    // Half, and the half this module can do anything about. kepler renders a
    // layer's controls from a method named `_render<Type>LayerConfig` on its
    // configurator, and there is none for a custom type, so no slider appears
    // yet however this is declared. Registering it is still the prerequisite:
    // a configurator has nothing to render from an empty `visConfigSettings`.
    expect(make().visConfigSettings.opacity).toBeDefined();
  });

  it('renders one deck layer when it knows a service', () => {
    const layers = make().renderLayer({ data: { metadata: META } });

    expect(layers).toHaveLength(1);
    const url = (built[0].getTileUrl as (b: typeof TILE) => string)(TILE);
    expect(url.startsWith(`${SERVICE}/exportImage?`)).toBe(true);
  });

  it('uses the mosaic rule its visConfig chose, over the one the dataset opened on', () => {
    // Where a timeline would park its choice, exactly as the painted COG layer
    // does with `cogScene`. The dataset is left alone as the window moves.
    const layer = make();
    layer.config.visConfig = { esriMosaicRule: RULE_2017 };
    layer.renderLayer({ data: { metadata: META } });

    const url = (built[0].getTileUrl as (b: typeof TILE) => string)(TILE);
    expect(url).toContain(encodeURIComponent('Year=2017'));
    expect(url).not.toContain(encodeURIComponent('Year=2023'));
  });

  it('says it should render even though it holds no rows', () => {
    expect(make().shouldRenderLayer()).toBe(true);
  });

  it('stays out of the way when it has been hidden', () => {
    const layer = make();
    layer.config.isVisible = false;

    expect(layer.shouldRenderLayer()).toBe(false);
  });

  it('renders nothing at all when it has no service yet', () => {
    expect(make().renderLayer({ data: { metadata: undefined } })).toEqual([]);
  });

  it('claims the datasets the panel minted for it, and no others', () => {
    const mine = (EsriLayer as any).findDefaultLayerProps({ type: 'esriImage', id: 'd1', label: 'Cobertura' });
    const theirs = (EsriLayer as any).findDefaultLayerProps({ type: 'cogPainted', id: 'd2', label: 'Otra' });

    expect(mine.props).toHaveLength(1);
    expect(mine.props[0]).toMatchObject({ dataId: 'd1', isVisible: true });
    expect(theirs.props).toHaveLength(0);
  });
});
