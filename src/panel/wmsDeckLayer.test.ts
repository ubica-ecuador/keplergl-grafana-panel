import { ClipExtension } from '@deck.gl/extensions';

import { TimedWMSLayer } from './wmsDeckLayer';

const SERVICE = 'https://data.geopf.fr/wms-r/wms';
const FRANCE = [-5.5, 41, 10, 51.5];

/**
 * The layer as deck leaves it after a picture of the view has landed: only
 * what `renderLayers` reads. Deck itself never runs here; the point is what
 * the picture is handed.
 */
function landed(props: Record<string, unknown>, viewport: Record<string, unknown> = {}) {
  const layer = new TimedWMSLayer({ id: 'wms', data: SERVICE, layers: ['CASSINI'], ...props } as any) as any;
  layer.state = { image: {}, bounds: [-30, 30, 30, 60], lastRequestParameters: { srs: 'EPSG:3857' } };
  layer.context = { viewport };
  return layer.renderLayers();
}

describe('TimedWMSLayer', () => {
  it('cuts the picture to the box its query gave', () => {
    const picture = landed({ clipBox: FRANCE });

    expect(picture.props.extensions.some((extension: unknown) => extension instanceof ClipExtension)).toBe(true);
    expect(picture.props.clipBounds).toEqual(FRANCE);
  });

  it('draws the picture whole without a box, and on a globe', () => {
    expect(landed({}).props.extensions ?? []).toEqual([]);
    expect(landed({ clipBox: FRANCE }, { resolution: 10 }).props.clipBounds).toBeUndefined();
  });

  it('hands deck the same extension on every render, so its shaders are built once', () => {
    const [a, b] = [landed({ clipBox: FRANCE }), landed({ clipBox: FRANCE })];

    expect(a.props.extensions[0]).toBe(b.props.extensions[0]);
  });
});

describe('TimedWMSLayer image source', () => {
  const source = (data: string) =>
    (new TimedWMSLayer({ id: 'wms', data, layers: ['CASSINI'] } as any) as any)._createImageSource({ data });
  const params = (url: string) => Object.fromEntries(new URLSearchParams(url.slice(url.indexOf('?') + 1)));
  const FRANCE_BOX = [
    [-5, 41],
    [10, 51],
  ];
  const viewport = { width: 256, height: 256, boundingBox: FRANCE_BOX as any, layers: ['CASSINI'] };

  it('asks GetMap and GetFeatureInfo for the style in the data url, so a click answers for the picture shown', () => {
    const styled = source(`${SERVICE}#s=${encodeURIComponent('dwd:rain classes')}`);

    expect(params(decodeURI(styled.getMapURL(viewport))).STYLES).toBe('dwd:rain classes');
    expect(
      params(decodeURI(styled.getFeatureInfoURL({ ...viewport, query_layers: ['CASSINI'], x: 1, y: 1 }))).STYLES
    ).toBe('dwd:rain classes');
  });

  it('sends an empty STYLES, the service default, without one', () => {
    expect(params(decodeURI(source(SERVICE).getMapURL(viewport))).STYLES).toBe('');
  });
});
