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

describe('TimedWMSLayer between two moments', () => {
  const IMAGE = { width: 256 };
  const PARAMETERS = { srs: 'EPSG:4326' };
  /** The layer after a picture has landed, with deck's own machinery stubbed: what updateState and loadImage touch. */
  function shown(data: string) {
    const layer = new TimedWMSLayer({ id: 'wms', data, layers: ['ICON_T2M'] } as any) as any;
    layer.state = { image: IMAGE, bounds: [-30, 30, 30, 60], lastRequestParameters: PARAMETERS, loadCounter: 0 };
    layer.context = { viewport: {} };
    layer.setState = (partial: object) => Object.assign(layer.state, partial);
    layer.debounce = jest.fn();
    layer._loadMetadata = jest.fn();
    layer.getRequestId = () => 2;
    return layer;
  }
  const move = (layer: any, data: string) =>
    layer.updateState({
      changeFlags: { dataChanged: true },
      props: { ...layer.props, data },
      oldProps: layer.props,
    });
  const AT_NOON = `${SERVICE}#t=2026-11-25T12%3A00%3A00.000Z`;
  const AT_THREE = `${SERVICE}#t=2026-11-25T15%3A00%3A00.000Z`;

  it('keeps the picture of the moment before while the next loads, and asks for the next', () => {
    const layer = shown(AT_NOON);
    move(layer, AT_THREE);

    expect(layer.state.image).toBe(IMAGE);
    // Not the parameters: kept, upstream would find the view covered and ask for nothing.
    expect(layer.state.lastRequestParameters).toBeUndefined();
    expect(layer.debounce).toHaveBeenCalled();
    // Drawn in the projection it was asked in, which upstream reads from those parameters.
    expect(layer.renderLayers().props._imageCoordinateSystem).toBe('lnglat');
    expect(layer.state.lastRequestParameters).toBeUndefined();
  });

  it('clears it for another service, as upstream does', () => {
    const layer = shown(AT_NOON);
    move(layer, 'https://maps.example.org/wms#t=2026-11-25T15%3A00%3A00.000Z');

    expect(layer.state.image).toBeUndefined();
  });

  it('lets the next picture replace it, and takes it away when the next fails', async () => {
    const landed = shown(AT_NOON);
    move(landed, AT_THREE);
    jest.spyOn(Object.getPrototypeOf(TimedWMSLayer.prototype), 'loadImage').mockImplementationOnce(async function (
      this: any
    ) {
      this.state.lastRequestParameters = PARAMETERS;
      this.state.image = { width: 512 };
    });
    await landed.loadImage({}, 'test');
    expect([landed.state.image, landed.state.heldParameters]).toEqual([{ width: 512 }, undefined]);

    // A step that fails, while the metadata is still being read (upstream counts that load too).
    const failed = shown(AT_NOON);
    move(failed, AT_THREE);
    failed.state.loadCounter = 1;
    jest.spyOn(Object.getPrototypeOf(TimedWMSLayer.prototype), 'loadImage').mockImplementationOnce(async () => {});
    await failed.loadImage({}, 'test');
    expect(failed.state.image).toBeUndefined();

    // Held over a step that failed before it could be replaced, it still goes when the next one fails.
    const twice = shown(AT_NOON);
    move(twice, AT_THREE);
    move(twice, `${SERVICE}#t=2026-11-25T18%3A00%3A00.000Z`);
    expect(twice.state.heldParameters).toBe(PARAMETERS);
    jest.spyOn(Object.getPrototypeOf(TimedWMSLayer.prototype), 'loadImage').mockImplementationOnce(async () => {});
    await twice.loadImage({}, 'test');
    expect(twice.state.image).toBeUndefined();
  });
});

describe('TimedWMSLayer at a moment the service refuses', () => {
  const REFUSED = new Error("WMS Service error: Could not find a match for 'time' value: '2026-11-30T23:00:00.000Z'");
  /** DWD's ICON past its first days: one hour in three. */
  const HELD = new Set(['2026-11-30T21:00:00.000Z']);
  function source(
    data: string,
    answer = (time: string) => (HELD.has(time) ? { width: 256 } : Promise.reject(REFUSED))
  ) {
    const built = (new TimedWMSLayer({ id: 'wms', data, layers: ['ICON_T2M'] } as any) as any)._createImageSource({
      data,
    });
    const asked: string[] = [];
    built.getMap = jest.fn(async () => {
      asked.push(built.wmsParameters.time);
      return answer(built.wmsParameters.time);
    });
    return { built, asked };
  }
  const box = {
    boundingBox: [
      [0, 0],
      [1, 1],
    ],
    width: 256,
    height: 256,
    layers: ['ICON_T2M'],
  };
  const AT = (earlier: string[]) =>
    `${SERVICE}#t=${encodeURIComponent('2026-11-30T23:00:00.000Z')}&e=${earlier.map(encodeURIComponent).join(',')}`;

  it('asks the dates before it in the window, and keeps the first that answers', async () => {
    const { built, asked } = source(AT(['2026-11-30T22:00:00.000Z', '2026-11-30T21:00:00.000Z']));

    await expect(built.getImage(box)).resolves.toEqual({ width: 256 });
    expect(asked).toEqual(['2026-11-30T23:00:00.000Z', '2026-11-30T22:00:00.000Z', '2026-11-30T21:00:00.000Z']);
    // A click asks the service about the picture shown.
    expect([built.wmsParameters.time, built.vendorParameters.time]).toEqual([
      '2026-11-30T21:00:00.000Z',
      '2026-11-30T21:00:00.000Z',
    ]);
  });

  it('throws the refusal of its own moment when every date is refused, and is back at it', async () => {
    const { built } = source(AT(['2026-11-30T22:00:00.000Z']));

    await expect(built.getImage(box)).rejects.toBe(REFUSED);
    expect(built.wmsParameters.time).toBe('2026-11-30T23:00:00.000Z');
  });

  it('asks nothing else when the service fails for another reason', async () => {
    const down = new Error('WMS Service error: Service Unavailable');
    const { built, asked } = source(AT(['2026-11-30T21:00:00.000Z']), () => Promise.reject(down));

    await expect(built.getImage(box)).rejects.toBe(down);
    expect(asked).toEqual(['2026-11-30T23:00:00.000Z']);
  });
});
