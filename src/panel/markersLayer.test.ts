import { MarkerDrag } from './markerDrag';
import { makeMarkersLayer, MARKERS_TYPE } from './markersLayer';

/** A stand-in for kepler's base Layer, with only what the subclass touches. */
class FakeBaseLayer {
  id = 'layer-1';
  config: Record<string, any> = { isVisible: true, visConfig: {} };
  meta: Record<string, unknown> = {};

  registerVisConfig(configs: Record<string, any>): void {
    for (const [key, item] of Object.entries(configs)) {
      this.config.visConfig[key] = item.defaultValue;
    }
  }

  updateMeta(meta: Record<string, unknown>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }

  get layerIcon(): unknown {
    return 'base-icon';
  }
}

const built: Array<Record<string, unknown>> = [];
const MarkersLayer = makeMarkersLayer(FakeBaseLayer, (props) => {
  built.push(props);
  return props;
}) as unknown as new () => FakeBaseLayer & {
  type: string;
  requireData: boolean;
  shouldRenderLayer(): boolean;
  formatLayerData(): unknown;
  renderLayer(opts?: { visible?: boolean }): unknown[];
};

const withMarkers = <T extends FakeBaseLayer>(layer: T): T => {
  layer.config.visConfig.markers = [
    { id: 'm1', label: 'A', latVariable: 'lat', lngVariable: 'lng', position: [-79, -2.9] },
    { id: 'm2', label: 'B', position: [-78, -3] },
  ];
  return layer;
};

beforeEach(() => {
  built.length = 0;
});

describe('markers layer', () => {
  it('registers an empty list and needs no rows', () => {
    const layer = new MarkersLayer();
    expect(layer.type).toBe(MARKERS_TYPE);
    expect(layer.config.visConfig.markers).toEqual([]);
    expect(layer.config.visConfig.markerRadius).toBe(10);
    expect(layer.requireData).toBe(false);
    expect(layer.shouldRenderLayer()).toBe(true);
    expect(layer.renderLayer()).toEqual([]);
  });

  it('is never proposed for a dataset', () => {
    expect((MarkersLayer as unknown as { findDefaultLayerProps(): unknown }).findDefaultLayerProps()).toEqual({
      props: [],
    });
  });

  it('publishes the markers bounds', () => {
    const layer = withMarkers(new MarkersLayer());
    layer.formatLayerData();
    expect(layer.meta.bounds).toEqual([-79, -3, -78, -2.9]);
  });

  it('hands the deck layer the markers, the radius and the pane verdict', () => {
    const layer = withMarkers(new MarkersLayer());
    layer.renderLayer({ visible: false });
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ id: 'layer-1-markers', keplerLayerId: 'layer-1', radiusPx: 10, visible: false });
    expect((built[0].markers as unknown[]).length).toBe(2);
    expect(built[0].symbol).toBe('circle');
    expect(built[0].angleDegrees).toBe(0);
  });

  it('draws the ringed circle by default and a catalogue glyph when chosen', () => {
    const layer = withMarkers(new MarkersLayer());
    expect(layer.config.visConfig.symbol).toBe('circle');
    layer.config.visConfig.symbol = 'pin';
    layer.renderLayer();
    layer.config.visConfig.symbol = 'not-a-glyph';
    layer.renderLayer();
    expect(built.map((props) => props.symbol)).toEqual(['pin', 'arrow']);
  });

  it('passes the rotation through, and a broken one as zero', () => {
    const layer = withMarkers(new MarkersLayer());
    layer.config.visConfig.angleDegrees = 90;
    layer.renderLayer();
    layer.config.visConfig.angleDegrees = 'north';
    layer.renderLayer();
    expect(built.map((props) => props.angleDegrees)).toEqual([90, 0]);
  });

  it('hands every deck copy of the layer one drag, and another layer a drag of its own', () => {
    // The copy drawn above the basemap's roads has to follow a drag handled by
    // the copy below it: they meet in the drag object, not in deck state.
    const layer = withMarkers(new MarkersLayer());
    const another = withMarkers(new MarkersLayer());
    layer.renderLayer();
    layer.renderLayer({ visible: true });
    another.renderLayer();

    expect(built[0].drag).toBeInstanceOf(MarkerDrag);
    expect(built[1].drag).toBe(built[0].drag);
    expect(built[2].drag).not.toBe(built[0].drag);
  });

  it('turns itself off with the eye button', () => {
    const layer = withMarkers(new MarkersLayer());
    layer.config.isVisible = false;
    expect(layer.shouldRenderLayer()).toBe(false);
  });
});
