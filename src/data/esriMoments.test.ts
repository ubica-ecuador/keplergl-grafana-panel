import { FieldType, toDataFrame } from '@grafana/data';

import { framesToEsri, mosaicRuleForTime } from './esriDataset';

const SERVICE = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer';

const rule = (year: number) => `{"mosaicMethod":"esriMosaicAttribute","where":"Year=${year}"}`;

/** A query that offers one moment per year, which is what a timeline walks. */
function datedFrame(years: number[], refId = 'A') {
  return toDataFrame({
    refId,
    fields: [
      { name: 'time', type: FieldType.time, values: years.map((y) => Date.UTC(y, 0, 1)) },
      { name: 'esri_url', type: FieldType.string, values: years.map(() => SERVICE) },
      { name: 'mosaic_rule', type: FieldType.string, values: years.map(rule) },
    ],
  });
}

describe('framesToEsri, on a dated query', () => {
  it('reads every row as a moment the clock can stop on', () => {
    const [service] = framesToEsri([datedFrame([2021, 2022, 2023])]);

    expect(service.moments).toHaveLength(3);
    expect(service.moments?.map((one) => one.mosaicRule)).toEqual([rule(2021), rule(2022), rule(2023)]);
  });

  it('opens on the newest moment, the way the raster and Zarr paths do', () => {
    const [service] = framesToEsri([datedFrame([2021, 2022, 2023])]);

    expect(service.mosaicRule).toBe(rule(2023));
  });

  it('keeps the moments in time order, whatever order the rows arrived in', () => {
    const [service] = framesToEsri([datedFrame([2023, 2021, 2022])]);

    expect(service.moments?.map((one) => one.time)).toEqual([
      Date.UTC(2021, 0, 1),
      Date.UTC(2022, 0, 1),
      Date.UTC(2023, 0, 1),
    ]);
  });

  it('offers no moments when the query is not dated', () => {
    // The ordinary single-service case: one row, no clock, nothing to walk.
    const plain = toDataFrame({
      refId: 'A',
      fields: [{ name: 'esri_url', type: FieldType.string, values: [SERVICE] }],
    });

    expect(framesToEsri([plain])[0].moments ?? []).toHaveLength(0);
  });
});

describe('mosaicRuleForTime', () => {
  it('answers with the rule the query gave for that moment', () => {
    const [service] = framesToEsri([datedFrame([2021, 2022, 2023])]);

    expect(mosaicRuleForTime(service, Date.UTC(2022, 0, 1))).toBe(rule(2022));
  });

  it('answers with nothing for a moment the query never offered', () => {
    // Sending a guess would draw a year the user did not ask for, silently.
    const [service] = framesToEsri([datedFrame([2021, 2022])]);

    expect(mosaicRuleForTime(service, Date.UTC(2030, 0, 1))).toBeUndefined();
  });
});
