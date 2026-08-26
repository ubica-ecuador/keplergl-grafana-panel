import { FieldType, toDataFrame } from '@grafana/data';

import { framesToWms, isPanelWmsId, serviceUrlOf, wmsDatasetId } from './wmsDataset';

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

  it('trims surrounding whitespace and trailing slashes', () => {
    expect(serviceUrlOf(`  ${SERVICE}/  `)).toBe(SERVICE);
  });
});

describe('framesToWms', () => {
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
