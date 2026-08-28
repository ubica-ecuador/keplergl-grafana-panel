import { cogPaintedDeckProps, makeCogPaintedLayer, CogPaintedMetadata } from './cogPaintedLayer';

const SCENE_ONE = 'https://data.test/io-lulc/17M_20230101-20240101.tif';
const SCENE_TWO = 'https://data.test/io-lulc/17M_20220101-20230101.tif';

const META: CogPaintedMetadata = {
  serverUrl: 'http://localhost:8088',
  sourceUrl: SCENE_ONE,
};

describe('cogPaintedDeckProps', () => {
  it('hands deck the tile template as its data', () => {
    const props = cogPaintedDeckProps({ id: 'layer-1', metadata: META });

    expect(String(props?.data)).toContain('/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?');
    expect(String(props?.data)).toContain(encodeURIComponent(SCENE_ONE));
  });

  it('puts the scene in updateTriggers.getTileData, not only in the url', () => {
    // The lesson PMTiles taught this repo: deck keeps serving the tiles it
    // fetched first unless a trigger it watches changes. Without this, moving
    // to another year would request the new image and still paint the old one.
    const first = cogPaintedDeckProps({ id: 'layer-1', metadata: META });
    const second = cogPaintedDeckProps({ id: 'layer-1', metadata: { ...META, sourceUrl: SCENE_TWO } });

    const triggerOf = (props: Record<string, unknown> | null) =>
      (props?.updateTriggers as { getTileData?: unknown })?.getTileData;

    expect(triggerOf(first)).toBeDefined();
    expect(triggerOf(first)).not.toEqual(triggerOf(second));
  });

  it('draws nothing when there is no metadata yet', () => {
    // A dataset arriving before its metadata is the ordinary first render.
    expect(cogPaintedDeckProps({ id: 'layer-1', metadata: undefined })).toBeNull();
  });

  it('draws nothing when no tile server was named', () => {
    expect(cogPaintedDeckProps({ id: 'layer-1', metadata: { ...META, serverUrl: '' } })).toBeNull();
  });

  it('carries the opacity kepler settled on', () => {
    expect(cogPaintedDeckProps({ id: 'layer-1', metadata: META, opacity: 0.4 })?.opacity).toBe(0.4);
  });

  it('names the deck layer after the kepler layer it belongs to', () => {
    expect(cogPaintedDeckProps({ id: 'layer-1', metadata: META })?.id).toContain('layer-1');
  });
});

/** A stand-in for kepler's base Layer, with only what the subclass touches. */
class FakeBaseLayer {
  config: { visConfig: Record<string, unknown>; isVisible?: boolean; dataId?: string } = {
    visConfig: {},
    isVisible: true,
  };
  id = 'layer-1';
  constructor(_props?: unknown) {}

  /**
   * kepler's own verdict, reproduced: `hasLayerData` demands `data.length`, so
   * a layer holding no rows is judged unrenderable and `renderLayer` is never
   * called on it.
   */
  shouldRenderLayer(_data?: unknown): boolean {
    return false;
  }
}

const built: Array<Record<string, unknown>> = [];
const fakeBuild = (props: Record<string, unknown>) => {
  built.push(props);
  return { props };
};

describe('makeCogPaintedLayer', () => {
  const CogLayer = makeCogPaintedLayer(FakeBaseLayer, fakeBuild);
  const make = () => new (CogLayer as never as new (p?: unknown) => any)();

  beforeEach(() => {
    built.length = 0;
  });

  it('answers to the type the dataset asks for', () => {
    expect(make().type).toBe('cogPainted');
  });

  it('renders one deck layer when it knows an image', () => {
    const layers = make().renderLayer({ data: { metadata: META } });

    expect(layers).toHaveLength(1);
    expect(String(built[0].data)).toContain('/cog/tiles/');
  });

  it('draws the scene its visConfig chose, over the one the dataset opened on', () => {
    // Where the timeline parks its choice. The dataset is left alone as the
    // window moves, exactly as the Zarr layer does with its label — a dataset
    // rebuild would hand back a layer with default styling.
    const layer = make();
    layer.config.visConfig = { cogScene: SCENE_TWO };
    layer.renderLayer({ data: { metadata: META } });

    expect(String(built[0].data)).toContain(encodeURIComponent(SCENE_TWO));
    expect(String(built[0].data)).not.toContain(encodeURIComponent(SCENE_ONE));
  });

  it('says it should render even though it holds no rows', () => {
    // The base class decides by counting rows, and a tileset has none: left
    // alone, kepler never calls `renderLayer` and the map stays empty with
    // nothing logged. `RasterTileLayer` overrides this for the same reason.
    expect(make().shouldRenderLayer()).toBe(true);
  });

  it('stays out of the way when it has been hidden', () => {
    const layer = make();
    layer.config.isVisible = false;

    expect(layer.shouldRenderLayer()).toBe(false);
  });

  it('renders nothing at all when it has no image yet', () => {
    expect(make().renderLayer({ data: { metadata: undefined } })).toEqual([]);
  });

  it('claims the datasets the panel minted for it, and no others', () => {
    // kepler asks every registered class about every dataset. Answering for
    // someone else's would draw a second, broken layer over a good one.
    const mine = (CogLayer as any).findDefaultLayerProps({ type: 'cogPainted', id: 'd1', label: 'Cobertura' });
    const theirs = (CogLayer as any).findDefaultLayerProps({ type: 'zarr', id: 'd2', label: 'Otra' });

    expect(mine.props).toHaveLength(1);
    expect(mine.props[0]).toMatchObject({ dataId: 'd1', isVisible: true });
    expect(theirs.props).toHaveLength(0);
  });
});
