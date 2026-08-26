import { readTimeFragment, shareMetadata, withTimeFragment, withWmsTime } from './wmsTimeLayer';

const SERVICE = 'https://services.geoglows.org/geoserver/satellite_based_precipitation/wms';
const TIME = '2026-08-20T00:00:00.000Z';

/**
 * A stand-in for a deck.gl layer as kepler's WMS layer builds one.
 *
 * Only `props` matters here: the wrapper's whole job is to hand a different
 * `data` to a layer built the same way otherwise.
 */
const fakeDeckLayer = (props: Record<string, unknown>) => ({ props, rendered: false });

/**
 * A stand-in for kepler's WMS layer, carrying only what the wrapper touches.
 *
 * `renderLayer` returning a layer whose `props.data` is the service url, and
 * `deckLayerRef` holding it afterwards, are both real: the first is how the
 * url reaches deck, the second is what GetFeatureInfo reads on a click.
 */
class FakeWMSLayer {
  config: { visConfig: Record<string, unknown> } = { visConfig: {} };
  deckLayerRef: unknown = null;
  type = 'wms';

  renderLayer(): unknown[] {
    const layer = fakeDeckLayer({ id: 'layer-1-WMSLayer', data: SERVICE, layers: ['persiann_pdir_24h'], opacity: 0.8 });
    this.deckLayerRef = layer;
    return [layer];
  }
}

const Timed = withWmsTime(FakeWMSLayer, fakeDeckLayer);

describe('withTimeFragment / readTimeFragment', () => {
  it('carries the time in a fragment, which never reaches the server', () => {
    const url = withTimeFragment(SERVICE, TIME);

    // A fragment is stripped by every HTTP client before the request is sent,
    // so even if this url were used unsplit it could not corrupt a GetMap.
    expect(url).toBe(`${SERVICE}#t=${encodeURIComponent(TIME)}`);
    expect(readTimeFragment(url)).toEqual({ url: SERVICE, time: TIME });
  });

  it('replaces the fragment rather than stacking fragments', () => {
    const once = withTimeFragment(SERVICE, TIME);
    const twice = withTimeFragment(once, '2026-07-20T00:00:00.000Z');

    expect(twice.match(/#/g)).toHaveLength(1);
    expect(readTimeFragment(twice).time).toBe('2026-07-20T00:00:00.000Z');
  });

  it('leaves a url alone when there is no time to carry', () => {
    expect(withTimeFragment(SERVICE, null)).toBe(SERVICE);
    expect(readTimeFragment(SERVICE)).toEqual({ url: SERVICE, time: undefined });
  });

  it('keeps a service url that already carries a query intact', () => {
    // Some deployments publish the endpoint with parameters already on it. The
    // query is the service's business; only the fragment is ours.
    const withQuery = `${SERVICE}?map=/data/rain.map`;

    expect(readTimeFragment(withTimeFragment(withQuery, TIME))).toEqual({ url: withQuery, time: TIME });
  });
});

describe('withWmsTime', () => {
  it('asks for no particular time when none has been chosen', () => {
    const layer = new Timed();

    const [rendered] = layer.renderLayer() as Array<{ props: { data: string } }>;

    // Still rebuilt, so the layer shares the one capabilities document the
    // panel fetches — but with a bare url, so the service answers with its own
    // default slice exactly as it does upstream.
    expect(rendered.props.data).toBe(SERVICE);
    expect(layer.deckLayerRef).toBe(rendered);
  });

  it('hands deck a data url carrying the chosen time', () => {
    const layer = new Timed();
    layer.config.visConfig.wmsTime = TIME;

    const [rendered] = layer.renderLayer() as Array<{ props: { data: string } }>;

    // The string differs, which is the point: deck compares `data` by identity
    // and only a change there recreates the image source and refetches.
    expect(readTimeFragment(rendered.props.data)).toEqual({ url: SERVICE, time: TIME });
  });

  it('keeps every other prop kepler assembled', () => {
    const layer = new Timed();
    layer.config.visConfig.wmsTime = TIME;

    const [rendered] = layer.renderLayer() as Array<{ props: Record<string, unknown> }>;

    expect(rendered.props.id).toBe('layer-1-WMSLayer');
    expect(rendered.props.layers).toEqual(['persiann_pdir_24h']);
    expect(rendered.props.opacity).toBe(0.8);
  });

  it('re-points deckLayerRef at the layer it actually returned', () => {
    const layer = new Timed();
    layer.config.visConfig.wmsTime = TIME;

    const [rendered] = layer.renderLayer() as unknown[];

    // Left pointing at the layer kepler built, GetFeatureInfo would read a
    // layer deck never rendered — no image source, and a click that returns
    // null without saying anything.
    expect(layer.deckLayerRef).toBe(rendered);
  });

  it('keeps the rest of the layer intact', () => {
    const layer = new Timed();

    expect(layer).toBeInstanceOf(FakeWMSLayer);
    expect(layer.type).toBe('wms');
  });

  it('leaves a layer that renders nothing alone rather than throwing', () => {
    class Empty {
      config = { visConfig: { wmsTime: TIME } };
      renderLayer(): unknown[] {
        return [];
      }
    }

    const layer = new (withWmsTime(Empty, fakeDeckLayer))();

    expect(layer.renderLayer()).toEqual([]);
  });
});

describe('shareMetadata', () => {
  const source = (answer: Promise<unknown>) => {
    const calls = { count: 0 };
    return { calls, source: { getMetadata: () => { calls.count++; return answer; } } };
  };

  it('asks once however many times it is called', async () => {
    const cache = new Map<string, Promise<unknown>>();
    const { calls, source: s } = source(Promise.resolve({ layers: [] }));
    shareMetadata(s, SERVICE, cache);

    await Promise.all([s.getMetadata(), s.getMetadata(), s.getMetadata()]);

    expect(calls.count).toBe(1);
  });

  it('does not call itself, which is the whole reason it exists', async () => {
    // Reaching for `source.getMetadata()` inside the replacement calls the
    // replacement: a stack overflow the first time a key is cold. It hid for a
    // while because whichever caller warmed the cache first spared the rest.
    const cache = new Map<string, Promise<unknown>>();
    const { source: s } = source(Promise.resolve('ok'));
    shareMetadata(s, SERVICE, cache);

    await expect(s.getMetadata()).resolves.toBe('ok');
  });

  it('shares one answer across every source built for the same service', async () => {
    const cache = new Map<string, Promise<unknown>>();
    const first = source(Promise.resolve('primera'));
    const second = source(Promise.resolve('segunda'));
    shareMetadata(first.source, SERVICE, cache);
    shareMetadata(second.source, SERVICE, cache);

    await first.source.getMetadata();

    // A new date builds a new image source; it must not re-read the catalogue.
    await expect(second.source.getMetadata()).resolves.toBe('primera');
    expect(second.calls.count).toBe(0);
  });

  it('forgets a failure, so a service that was briefly down can recover', async () => {
    const cache = new Map<string, Promise<unknown>>();
    const { source: s } = source(Promise.reject(new Error('down')));
    shareMetadata(s, SERVICE, cache);

    await expect(s.getMetadata()).rejects.toThrow('down');
    // Awaited so the catch that clears the entry has run.
    await Promise.resolve();

    expect(cache.has(SERVICE)).toBe(false);
  });
});
