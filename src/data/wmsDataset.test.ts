import { FieldType, toDataFrame } from '@grafana/data';

import { framesToWms, isPanelWmsId, parseWmsBox, serviceUrlOf, wmsDatasetId } from './wmsDataset';

const SERVICE = 'https://services.geoglows.org/geoserver/satellite_based_precipitation/wms';
const LAYER = 'persiann_pdir_24h';

function wmsFrame(
  { url = SERVICE, layer = LAYER, times }: { url?: string; layer?: string; times?: number[] } = {},
  refId = 'A'
) {
  const rows = times?.length ?? 1;
  return toDataFrame({
    refId,
    fields: [
      { name: 'wms_url', type: FieldType.string, values: Array(rows).fill(url) },
      { name: 'wms_layer', type: FieldType.string, values: Array(rows).fill(layer) },
      ...(times ? [{ name: 'time', type: FieldType.time, values: times }] : []),
    ],
  });
}

describe('serviceUrlOf', () => {
  it('keeps an endpoint that is already bare', () => {
    expect(serviceUrlOf(SERVICE)).toBe(SERVICE);
  });

  it('drops a query string, because loaders.gl cannot survive one', () => {
    // `WMSImageSource` appends its parameters starting with `?` without looking
    // whether the url already has one, so a GetMap url pasted whole comes back
    // as `…?a=b?SERVICE=WMS&…` and the server reads the two halves as one
    // value. Pasting a whole GetMap url is exactly what people do, so this is
    // the common case rather than a corner.
    expect(serviceUrlOf(`${SERVICE}?service=WMS&request=GetMap&layers=${LAYER}`)).toBe(SERVICE);
  });

  it('drops a fragment, which is the panel’s own channel', () => {
    expect(serviceUrlOf(`${SERVICE}#t=2026-08-20T00%3A00%3A00.000Z`)).toBe(SERVICE);
  });

  it('trims surrounding whitespace, and keeps a trailing slash a service may need', () => {
    expect(serviceUrlOf(`  ${SERVICE}  `)).toBe(SERVICE);
    // NASA GIBS answers at …/best/ (its capabilities' address), not at …/best.
    expect(serviceUrlOf('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/?')).toBe(
      'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/'
    );
  });
});

describe('framesToWms', () => {
  it('carries the style, the legend and the title of the row that names the service and the layer', () => {
    // The Spatial Catalog's Services frame: a WMS row beside an empty one.
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'wms_url', type: FieldType.string, values: ['', SERVICE] },
        { name: 'wms_layer', type: FieldType.string, values: ['', LAYER] },
        { name: 'wms_style', type: FieldType.string, values: ['other', ' rain_classes '] },
        { name: 'legend_url', type: FieldType.string, values: ['', `${SERVICE}?request=GetLegendGraphic`] },
        { name: 'title', type: FieldType.string, values: ['Some other service', 'PERSIANN 24 h'] },
      ],
    });

    const [wms] = framesToWms([frame]);

    expect(wms).toMatchObject({
      style: 'rain_classes',
      legendUrl: `${SERVICE}?request=GetLegendGraphic`,
      label: 'PERSIANN 24 h',
    });
  });

  it('gives no style for an empty one, which is the service default', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'wms_url', type: FieldType.string, values: [SERVICE] },
        { name: 'wms_layer', type: FieldType.string, values: [LAYER] },
        { name: 'wms_style', type: FieldType.string, values: ['  '] },
      ],
    });

    const [wms] = framesToWms([frame]);

    expect(wms.style).toBeUndefined();
    expect(wms.legendUrl).toBeUndefined();
    // No title column: the query's name, as before.
    expect(wms.label).toBe('Query A');
  });

  it('describes the service and layer a query points at', () => {
    const [wms] = framesToWms([wmsFrame()]);

    expect(wms).toMatchObject({ id: 'grafana-A-wms', serviceUrl: SERVICE, layerName: LAYER, times: [] });
  });

  it('ignores a frame with no wms columns', () => {
    const plain = toDataFrame({ refId: 'A', fields: [{ name: 'value', type: FieldType.number, values: [1] }] });

    expect(framesToWms([plain])).toEqual([]);
  });

  it('needs the layer as well as the service', () => {
    const noLayer = toDataFrame({
      refId: 'A',
      fields: [{ name: 'wms_url', type: FieldType.string, values: [SERVICE] }],
    });

    // A service publishes many layers; without one named there is no picture to
    // draw, and guessing the first would draw something nobody asked for.
    expect(framesToWms([noLayer])).toEqual([]);
  });

  it('collects every moment the query offered, oldest first and without repeats', () => {
    const [wms] = framesToWms([wmsFrame({ times: [300, 100, 200, 100] })]);

    expect(wms.times).toEqual([100, 200, 300]);
  });

  it('takes the service and layer from the first usable row', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'wms_url', type: FieldType.string, values: ['', SERVICE] },
        { name: 'wms_layer', type: FieldType.string, values: ['', LAYER] },
      ],
    });

    expect(framesToWms([frame])[0]).toMatchObject({ serviceUrl: SERVICE, layerName: LAYER });
  });

  it('lets an override point the role at another column', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'endpoint', type: FieldType.string, values: [SERVICE] },
        { name: 'wms_layer', type: FieldType.string, values: [LAYER] },
      ],
    });

    expect(framesToWms([frame], { A: { wmsUrl: 'endpoint' } })[0]).toMatchObject({ serviceUrl: SERVICE });
  });

  it('is switched off by an override of null', () => {
    expect(framesToWms([wmsFrame()], { A: { wmsUrl: null } })).toEqual([]);
  });

  it('names each query’s dataset apart from its table', () => {
    // The rows are a perfectly good table in their own right — service, layer,
    // dates — and the suffix is what lets both live on the same map.
    expect(wmsDatasetId('B')).toBe('grafana-B-wms');
    expect(isPanelWmsId('grafana-B-wms')).toBe(true);
    expect(isPanelWmsId('grafana-B-raster')).toBe(false);
    expect(isPanelWmsId('a-tileset-someone-added-wms')).toBe(false);
  });
});

describe('parseWmsBox', () => {
  it('reads the Spatial Catalog’s text, west south east north with spaces', () => {
    // IGN's Cassini map: France.
    expect(parseWmsBox('-5.5 41 10 51.5')).toEqual([-5.5, 41, 10, 51.5]);
  });

  it('reads commas, brackets and a list too, as a hand-written query writes them', () => {
    expect(parseWmsBox('-5.5,41,10,51.5')).toEqual([-5.5, 41, 10, 51.5]);
    expect(parseWmsBox('[-5.5, 41, 10, 51.5]')).toEqual([-5.5, 41, 10, 51.5]);
    expect(parseWmsBox([-5.5, 41, 10, 51.5])).toEqual([-5.5, 41, 10, 51.5]);
  });

  it('keeps a box across the antimeridian as written, west greater than east', () => {
    expect(parseWmsBox('177 -21 -178 -12')).toEqual([177, -21, -178, -12]);
  });

  it('pulls a box a hair outside the world back to its edge', () => {
    expect(parseWmsBox('-180.0000001 -90 180 90')).toEqual([-180, -90, 180, 90]);
  });

  it('is null for anything that is not a box in degrees', () => {
    for (const value of [
      undefined,
      null,
      '',
      'France',
      '-5.5 41 10',
      '-5.5 41 10 51.5 7',
      '-5.5 51.5 10 41', // south north of its north
      '10 41 10 51.5', // no width
      '-612000 5050000 1120000 6730000', // metres, not degrees
      42,
    ]) {
      expect(parseWmsBox(value)).toBeNull();
    }
  });
});

describe('framesToWms and tiles_bbox', () => {
  const framed = (boxes: unknown[], urls: unknown[] = boxes.map(() => SERVICE)) =>
    toDataFrame({
      refId: 'A',
      fields: [
        { name: 'wms_url', type: FieldType.string, values: urls },
        { name: 'wms_layer', type: FieldType.string, values: urls.map(() => LAYER) },
        { name: 'tiles_bbox', type: FieldType.string, values: boxes },
      ],
    });

  it('carries the box of the layer', () => {
    expect(framesToWms([framed(['-5.5 41 10 51.5'])])[0].bbox).toEqual([-5.5, 41, 10, 51.5]);
  });

  it('reads it from the row that named the service and the layer', () => {
    const [wms] = framesToWms([framed(['0 0 1 1', '-5.5 41 10 51.5'], [null, SERVICE])]);

    expect(wms.bbox).toEqual([-5.5, 41, 10, 51.5]);
  });

  it('has none without the column, or with a value that is no box', () => {
    expect(framesToWms([wmsFrame()])[0].bbox).toBeNull();
    expect(framesToWms([framed(['somewhere'])])[0].bbox).toBeNull();
  });
});
