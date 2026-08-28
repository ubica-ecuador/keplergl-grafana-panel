import { makeZarrLayer, zarrDeckProps, ZarrTileMetadata } from './zarrTileLayer';

const META: ZarrTileMetadata = {
  serverUrl: 'http://localhost:8088',
  storeUrl: 'https://data.test/gpcp.zarr',
  variable: 'precip',
  colormap: 'blues',
  rescale: '0,30',
};

const LABEL_ONE = '1996-10-01T00:00:00.000000000';
const LABEL_TWO = '1996-10-02T00:00:00.000000000';

describe('zarrDeckProps', () => {
  it('hands deck the tile template as its data', () => {
    const props = zarrDeckProps({ id: 'layer-1', metadata: META, label: LABEL_ONE });

    expect(String(props?.data)).toContain('/zarr/tiles/WebMercatorQuad/{z}/{x}/{y}.png?');
    expect(String(props?.data)).toContain('sel=time%3D1996-10-01T00%3A00%3A00.000000000');
  });

  it('puts the moment in updateTriggers.getTileData, not only in the url', () => {
    // The lesson PMTiles taught this repo: deck keeps serving cached tiles for
    // whatever it fetched first unless a trigger it watches changes. Without
    // this, every date on the timeline paints the same picture, and the only
    // visible symptom is requests that are never tiles.
    const first = zarrDeckProps({ id: 'layer-1', metadata: META, label: LABEL_ONE });
    const second = zarrDeckProps({ id: 'layer-1', metadata: META, label: LABEL_TWO });

    const triggerOf = (props: Record<string, unknown> | null) =>
      (props?.updateTriggers as { getTileData?: unknown })?.getTileData;

    expect(triggerOf(first)).toBeDefined();
    expect(triggerOf(first)).not.toEqual(triggerOf(second));
  });

  it('draws nothing when the store names no variable', () => {
    expect(zarrDeckProps({ id: 'layer-1', metadata: { ...META, variable: '' } })).toBeNull();
  });

  it('carries the opacity kepler settled on', () => {
    expect(zarrDeckProps({ id: 'layer-1', metadata: META, opacity: 0.4 })?.opacity).toBe(0.4);
  });

  it('stops asking past the deepest level a pyramid has', () => {
    // deck reuses the deepest tile it holds beyond `maxZoom`. Without it, every
    // zoom past the pyramid asks for a group the store does not have and gets a
    // 500 for its trouble — on every tile, for ever.
    const props = zarrDeckProps({ id: 'layer-1', metadata: { ...META, levels: 6 } });

    expect(props?.maxZoom).toBe(5);
  });

  it('leaves the zoom unbounded for a store with no pyramid', () => {
    // A single-level store answers at any zoom: the server reads native
    // resolution and resamples. Slow, but not an error.
    expect(zarrDeckProps({ id: 'layer-1', metadata: META })?.maxZoom).toBeUndefined();
  });

  it('names the deck layer after the kepler layer it belongs to', () => {
    expect(zarrDeckProps({ id: 'layer-1', metadata: META })?.id).toContain('layer-1');
  });
});

/** A stand-in for kepler's base Layer, with only what the subclass touches. */
class FakeBaseLayer {
  config: { visConfig: Record<string, unknown>; isVisible?: boolean } = { visConfig: {}, isVisible: true };
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

describe('makeZarrLayer', () => {
  const ZarrLayer = makeZarrLayer(FakeBaseLayer, fakeBuild);

  beforeEach(() => {
    built.length = 0;
  });

  it('switches itself off in the split-map pane it was hidden in', () => {
    // kepler hands every layer to deck whether or not the pane shows it:
    // `renderDeckGlLayer` works out `visible` from `splitMaps[i].layers` and
    // passes it in, leaving each layer to apply it. Ignore it and the legend's
    // per-pane eyes change the state and switch nothing off — which is exactly
    // what a split screen meant to compare two years cannot afford.
    new (ZarrLayer as never as new (p?: unknown) => any)().renderLayer({
      data: { metadata: META },
      visible: false,
    });

    expect(built[0].visible).toBe(false);
  });

  /** Renders the way kepler does: the formatted layer data arrives in `opts`. */
  function render(metadata: ZarrTileMetadata | undefined, label?: string) {
    const layer = new (ZarrLayer as never as new (p?: unknown) => any)();
    layer.config.visConfig = { opacity: 0.8, zarrLabel: label };
    return layer.renderLayer({ data: { metadata } });
  }

  it('answers to the type the dataset asks for', () => {
    expect(new (ZarrLayer as never as new (p?: unknown) => any)().type).toBe('zarr');
  });

  it('renders one deck layer when it knows a store', () => {
    const layers = render(META, LABEL_ONE);

    expect(layers).toHaveLength(1);
    expect(String(built[0].data)).toContain('/zarr/tiles/');
  });

  it('asks for the moment its visConfig chose', () => {
    // The date lives in visConfig because that is what kepler recomputes a
    // layer for; the dataset is never touched as the timeline moves.
    render(META, LABEL_TWO);

    expect(String(built[0].data)).toContain('sel=time%3D1996-10-02T00%3A00%3A00.000000000');
  });

  it('says it should render even though it holds no rows', () => {
    // The base class decides by counting rows, and a tileset has none: left
    // alone, kepler never calls `renderLayer` at all and the map stays empty
    // with nothing logged. `RasterTileLayer` overrides this for the same reason.
    const layer = new (ZarrLayer as never as new (p?: unknown) => any)();

    expect(layer.shouldRenderLayer()).toBe(true);
  });

  it('stays out of the way when it has been hidden', () => {
    // The timeline hides the layer whenever the window holds no moment, and a
    // hidden layer that still drew would defeat that entirely.
    const layer = new (ZarrLayer as never as new (p?: unknown) => any)();
    layer.config.isVisible = false;

    expect(layer.shouldRenderLayer()).toBe(false);
  });

  it('renders nothing at all when it has no store yet', () => {
    // A dataset arriving before its metadata is the ordinary first render, and
    // an exception there takes the whole map down with it.
    expect(render(undefined)).toEqual([]);
  });

  it('claims a zarr dataset and leaves every other kind alone', () => {
    // The mixin's return type is the base class it was given, so the static it
    // adds is invisible to the compiler — the same gap `withWmsTime` has.
    const claims = ZarrLayer as unknown as {
      findDefaultLayerProps(dataset: unknown): { props: unknown[] };
    };

    expect(claims.findDefaultLayerProps({ type: 'zarr', id: 'd1' }).props).toHaveLength(1);
    expect(claims.findDefaultLayerProps({ type: 'raster-tile', id: 'd1' }).props).toEqual([]);
  });
});
