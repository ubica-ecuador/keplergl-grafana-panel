import { FieldType, toDataFrame } from '@grafana/data';

import { framesToEsri, isPanelEsriId } from './esriDataset';

const SERVICE = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer';
const RULE = '{"mosaicMethod":"esriMosaicAttribute","where":"Year=2023"}';

function esriFrame(fields: Record<string, string>, refId = 'A') {
  return toDataFrame({
    refId,
    fields: Object.entries(fields).map(([name, value]) => ({
      name,
      type: FieldType.string,
      values: [value],
    })),
  });
}

describe('framesToEsri', () => {
  it('describes the service a query points at', () => {
    const [service] = framesToEsri([esriFrame({ esri_url: SERVICE })]);

    expect(service).toMatchObject({ id: 'grafana-A-esri', serviceUrl: SERVICE });
  });

  it('carries the rule that picks which rasters to draw', () => {
    const [service] = framesToEsri([esriFrame({ esri_url: SERVICE, mosaic_rule: RULE })]);

    expect(service.mosaicRule).toBe(RULE);
  });

  it('carries a rendering rule when the query gives one', () => {
    const rule = '{"rasterFunction":"Stretch"}';
    const [service] = framesToEsri([esriFrame({ esri_url: SERVICE, rendering_rule: rule })]);

    expect(service.renderingRule).toBe(rule);
  });

  it('ignores a frame that names no service', () => {
    // The ordinary case: most queries are rows of data, and every one of them
    // passes through here.
    expect(framesToEsri([esriFrame({ lat: '1', lng: '2' })])).toHaveLength(0);
  });

  it('ignores a frame whose service cell is blank', () => {
    expect(framesToEsri([esriFrame({ esri_url: '   ' })])).toHaveLength(0);
  });

  it('describes one service per query, so two queries make two layers', () => {
    const services = framesToEsri([
      esriFrame({ esri_url: SERVICE }, 'A'),
      esriFrame({ esri_url: `${SERVICE}2` }, 'B'),
    ]);

    expect(services.map((one) => one.id)).toEqual(['grafana-A-esri', 'grafana-B-esri']);
  });
});

describe('isPanelEsriId', () => {
  it('knows the ids the panel mints from every other', () => {
    // What tells "mine, drop it on refresh" from a layer the user added by
    // hand through kepler's own form, which must survive every refresh.
    expect(isPanelEsriId('grafana-A-esri')).toBe(true);
    expect(isPanelEsriId('grafana-A-raster')).toBe(false);
    expect(isPanelEsriId('something-else')).toBe(false);
  });
});
