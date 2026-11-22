import { readTimeFragment, shareMetadata, withTimeFragment, withWmsTime, wmsMapLibreTemplate } from './wmsTimeLayer';

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

  it('carries a style beside the time, or alone, and reads both back', () => {
    const both = withTimeFragment(SERVICE, TIME, 'dwd:rain & snow');
    const alone = withTimeFragment(SERVICE, null, 'rain_classes');

    expect(both).toBe(`${SERVICE}#t=${encodeURIComponent(TIME)}&s=${encodeURIComponent('dwd:rain & snow')}`);
    expect(readTimeFragment(both)).toEqual({ url: SERVICE, time: TIME, style: 'dwd:rain & snow' });
    expect(readTimeFragment(alone)).toEqual({ url: SERVICE, style: 'rain_classes' });
    expect(withTimeFragment(alone, null, '')).toBe(SERVICE);
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

  it('hands deck a data url carrying the style the query names, so a new style is a new picture', () => {
    const layer = new Timed();
    layer.config.visConfig.wmsTime = TIME;
    layer.config.visConfig.wmsStyle = 'rain_classes';

    const [first] = layer.renderLayer() as Array<{ props: { data: string } }>;
    layer.config.visConfig.wmsStyle = 'rain_contours';
    const [second] = layer.renderLayer() as Array<{ props: { data: string } }>;
    layer.config.visConfig.wmsStyle = '';
    const [byDefault] = layer.renderLayer() as Array<{ props: { data: string } }>;

    expect(readTimeFragment(first.props.data)).toEqual({ url: SERVICE, time: TIME, style: 'rain_classes' });
    expect(second.props.data).not.toBe(first.props.data);
    expect(readTimeFragment(byDefault.props.data)).toEqual({ url: SERVICE, time: TIME });
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
    return {
      calls,
      source: {
        getMetadata: () => {
          calls.count++;
          return answer;
        },
      },
    };
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

describe('wmsMapLibreTemplate', () => {
  const params = (url: string) => Object.fromEntries(new URLSearchParams(url.slice(url.indexOf('?') + 1)));

  it('asks GetMap in Web Mercator, one 256 px tile at a time, at the chosen moment', () => {
    const template = wmsMapLibreTemplate({ url: `${SERVICE}#t=x`, layers: ['a', 'b'], time: TIME })!;
    expect(template.startsWith(`${SERVICE}?`)).toBe(true);
    expect(template.endsWith('&BBOX={bbox-epsg-3857}')).toBe(true);
    expect(params(template)).toMatchObject({
      SERVICE: 'WMS',
      VERSION: '1.3.0',
      REQUEST: 'GetMap',
      LAYERS: 'a,b',
      CRS: 'EPSG:3857',
      WIDTH: '256',
      HEIGHT: '256',
      FORMAT: 'image/png',
      TRANSPARENT: 'TRUE',
      TIME,
    });
  });

  it('keeps the service’s own query', () => {
    const template = wmsMapLibreTemplate({
      url: 'https://ms.example/cgi?map=/x.map',
      layers: ['a'],
      transparent: false,
    })!;
    expect(template.startsWith('https://ms.example/cgi?map=/x.map&SERVICE=WMS')).toBe(true);
    expect(params(template).TRANSPARENT).toBe('FALSE');
  });

  it('is null with no layer to ask for', () => {
    expect(wmsMapLibreTemplate({ url: SERVICE, layers: [] })).toBeNull();
  });

  it('asks for the style the query names, and the default without one', () => {
    expect(params(wmsMapLibreTemplate({ url: SERVICE, layers: ['a'], style: 'rain_classes' })!).STYLES).toBe(
      'rain_classes'
    );
    expect(params(wmsMapLibreTemplate({ url: SERVICE, layers: ['a'] })!).STYLES).toBe('');
  });
});

describe('withWmsTime on a relief base map', () => {
  class Layer extends FakeWMSLayer {
    pickable = false;
    renderLayer(): unknown[] {
      const [layer] = super.renderLayer() as Array<{ props: Record<string, unknown> }>;
      return [fakeDeckLayer({ ...layer.props, pickable: this.pickable })];
    }
  }
  const Relief = withWmsTime(Layer, fakeDeckLayer);

  it('offers MapLibre a WMS that answers no click', () => {
    const layer = new Relief();
    layer.config.visConfig.wmsTime = TIME;
    const [rendered] = layer.renderLayer() as Array<{ props: Record<string, unknown> }>;
    expect(String(rendered.props.reliefTiles)).toContain(`TIME=${encodeURIComponent(TIME)}`);
  });

  it('keeps with deck a WMS a click asks about', () => {
    const layer = new Relief();
    layer.pickable = true;
    const [rendered] = layer.renderLayer() as Array<{ props: Record<string, unknown> }>;
    expect(rendered.props.reliefTiles).toBeUndefined();
  });
});

describe('withWmsTime and the layer’s box', () => {
  const FRANCE = [-5.5, 41, 10, 51.5];
  const render = (metadata: Record<string, unknown> | undefined, pickable = true) => {
    class Layer extends FakeWMSLayer {
      renderLayer(): unknown[] {
        const [layer] = super.renderLayer() as Array<{ props: Record<string, unknown> }>;
        return [fakeDeckLayer({ ...layer.props, pickable })];
      }
    }
    const layer = new (withWmsTime(Layer, fakeDeckLayer))();
    const [rendered] = (layer.renderLayer as (opts: unknown) => unknown[])({ data: { metadata } }) as Array<{
      props: Record<string, unknown>;
    }>;
    return rendered.props;
  };

  it('hands deck the box the dataset carries, to cut the picture to', () => {
    expect(render({ tilesBbox: FRANCE }).clipBox).toEqual(FRANCE);
  });

  it('hands it none when the dataset carries none, or a broken one', () => {
    expect(render(undefined).clipBox).toBeUndefined();
    expect(render({ tilesBbox: [1, 2, 3] }).clipBox).toBeUndefined();
  });

  it('bounds the MapLibre source on a relief base map', () => {
    expect(render({ tilesBbox: FRANCE }, false).reliefBounds).toEqual(FRANCE);
  });
});
