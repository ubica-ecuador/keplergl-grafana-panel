import { withFlowRefresh } from './flowLayerRefresh';

/** Stands in for @flowmap.gl's `FlowmapLayer`: a deck layer is its props. */
class FakeFlowmapLayer {
  props: Record<string, unknown>;

  constructor(props: Record<string, unknown>) {
    this.props = props;
  }
}

/**
 * Stands in for kepler's `FlowLayer`, down to the counter at fault.
 *
 * Each instance owns a data provider and a version it bumps when the flows it
 * holds change, and hands both to the deck layer — `data: this._dataVersion`
 * in `flow-layer.js`. A refresh builds a new instance, whose counter starts
 * again from zero.
 */
class FakeKeplerFlowLayer {
  provider = { flows: [] as unknown[] };
  version = 0;

  load(flows: unknown[]): void {
    this.provider.flows = flows;
    this.version += 1;
  }

  renderLayer(): unknown[] {
    return [new FakeFlowmapLayer({ id: 'next-stops', dataProvider: this.provider, data: this.version, opacity: 0.8 })];
  }
}

const Wrapped = withFlowRefresh(FakeKeplerFlowLayer) as unknown as new () => FakeKeplerFlowLayer;

function deckData(layer: FakeKeplerFlowLayer): unknown {
  const [deckLayer] = layer.renderLayer() as FakeFlowmapLayer[];
  return deckLayer.props.data;
}

describe('withFlowRefresh', () => {
  it('gives the layer a refresh builds a data value the one it replaces never had', () => {
    // The bug: both instances say `data: 1`, deck matches them by id, sees no
    // data change, and FlowmapLayer keeps drawing the old instance's flows.
    const before = new Wrapped();
    before.load(['old flows']);
    const after = new Wrapped();
    after.load(['new flows']);

    const a = deckData(before);
    const b = deckData(after);

    expect(b).not.toEqual(a);
    // A string would be taken by deck for a URL to fetch.
    expect(typeof a).toBe('number');
    expect(typeof b).toBe('number');
  });

  it('keeps the data value while the flows have not changed', () => {
    // A new value on every render would make FlowmapLayer rebuild its data on
    // every frame of the animation.
    const layer = new Wrapped();
    layer.load(['flows']);

    expect(deckData(layer)).toBe(deckData(layer));
  });

  it('moves the data value when the same layer is handed new flows', () => {
    const layer = new Wrapped();
    layer.load(['first']);
    const first = deckData(layer);
    layer.load(['second']);

    expect(deckData(layer)).not.toBe(first);
  });

  it('keeps every other prop, and the class deck matches layers by', () => {
    const layer = new Wrapped();
    layer.load(['flows']);
    const [deckLayer] = layer.renderLayer() as FakeFlowmapLayer[];

    expect(deckLayer).toBeInstanceOf(FakeFlowmapLayer);
    expect(deckLayer.props.id).toBe('next-stops');
    expect(deckLayer.props.opacity).toBe(0.8);
    expect(deckLayer.props.dataProvider).toBe(layer.provider);
  });

  it('leaves alone what carries no data provider', () => {
    class Bare {
      renderLayer(): unknown[] {
        return [null, { props: { id: 'x', data: 3 } }];
      }
    }
    const WrappedBare = withFlowRefresh(Bare) as unknown as new () => Bare;

    expect(new WrappedBare().renderLayer()).toEqual([null, { props: { id: 'x', data: 3 } }]);
  });
});
