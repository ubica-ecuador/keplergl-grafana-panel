/**
 * Makes kepler's flow layer redraw when a refresh brings new flows.
 *
 * kepler hands @flowmap.gl's `FlowmapLayer` its flows through a data provider
 * that each kepler layer owns, and tells deck they changed by passing
 * `data: this._dataVersion` — a counter kept on the kepler layer, bumped when
 * the flows it holds change (`flow-layer.js`, kepler 3.3.0-alpha.13). But a
 * refresh replaces the dataset, and kepler builds a *new* layer for it, whose
 * counter starts again from zero. The first render of the new layer says
 * `data: 1`, exactly like the first render of the old one; deck matches the two
 * by id, sees no data change, and `FlowmapLayer` swaps its data provider only
 * on a data change (`FlowmapLayer.js`, `updateState`). So it goes on drawing
 * the flows of the layer that is gone: every other layer on the map moves with
 * the refresh and the flows stay where they were.
 *
 * Measured on trimet-live after a refresh: deck drew 393 flows while the store
 * held 389, and the deck layer's `state.dataProvider` was no longer its
 * `props.dataProvider`.
 *
 * **The repair.** The deck layer is rebuilt with a `data` value that names the
 * pair (data provider, kepler's version) instead of the version alone. A new
 * kepler layer brings a new provider, so its value is one deck has never seen;
 * a render that changes nothing brings the same pair back, and the same value,
 * so `FlowmapLayer` does not rebuild its data on every frame of the animation.
 * A number, because deck takes a string `data` for a URL to fetch.
 *
 * Wrapped as a class in the registry, like `withWmsTime` and
 * `withTile3dAltitude`: kepler builds its layers itself, and by the time an
 * instance could be reached from outside the deck layer has already gone to the
 * renderer. The deck layer is rebuilt from the props kepler assembled, so
 * nothing else about it changes.
 */

// The usual mixin constructor type. `any[]` rather than `unknown[]` on purpose:
// constructor parameters are checked contravariantly, so `unknown[]` would
// reject every concrete class — including kepler's own.
type Constructor<T> = new (...args: any[]) => T;

/** The member of kepler's flow layer this wrapper touches. */
interface FlowLayerLike {
  renderLayer(opts?: unknown): unknown[];
}

/** A deck layer, as far as the rebuild cares. */
interface DeckLayerLike {
  props: Record<string, unknown>;
  constructor: Function;
}

function isDeckLayerWithProvider(value: unknown): value is DeckLayerLike {
  if (!value || typeof value !== 'object' || !('props' in value)) {
    return false;
  }
  const provider = (value as DeckLayerLike).props.dataProvider;
  return Boolean(provider) && typeof provider === 'object';
}

/**
 * One value per (data provider, kepler version) pair, for the life of the page.
 *
 * Keyed weakly on the provider so a replaced layer's entries go with it.
 */
const dataValues = new WeakMap<object, Map<unknown, number>>();
let lastDataValue = 0;

function dataValueFor(provider: object, version: unknown): number {
  let byVersion = dataValues.get(provider);
  if (!byVersion) {
    byVersion = new Map();
    dataValues.set(provider, byVersion);
  }
  let value = byVersion.get(version);
  if (value === undefined) {
    lastDataValue += 1;
    value = lastDataValue;
    byVersion.set(version, value);
  }
  return value;
}

/** Wraps kepler's flow layer class so a refresh redraws its flows. */
export function withFlowRefresh<C extends Constructor<object>>(FlowLayer: C): C {
  class FlowLayerThatRefreshes extends (FlowLayer as Constructor<FlowLayerLike>) {
    renderLayer(opts?: unknown): unknown[] {
      const layers = super.renderLayer(opts) ?? [];
      return layers.map((layer) => {
        if (!isDeckLayerWithProvider(layer)) {
          return layer;
        }
        const DeckLayer = layer.constructor as Constructor<object>;
        const data = dataValueFor(layer.props.dataProvider as object, layer.props.data);
        return new DeckLayer({ ...layer.props, data });
      });
    }
  }

  return FlowLayerThatRefreshes as unknown as C;
}
