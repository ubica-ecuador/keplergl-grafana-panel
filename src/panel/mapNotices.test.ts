import { FieldType, toDataFrame } from '@grafana/data';

import { frameNotices, orderNotices, outOfRangeNotices, queryErrorNotices, undrawnServiceNotices } from './mapNotices';

describe('queryErrorNotices', () => {
  it('names the query and says what it said, the data source’s own message first', () => {
    expect(
      queryErrorNotices([
        { refId: 'A', message: 'Query error: 500', data: { message: 'The service refused the time range' } },
        { refId: 'B', message: 'timeout' },
        { message: 'Bad gateway' },
      ])
    ).toEqual([
      { severity: 'error', text: 'Query A: The service refused the time range' },
      { severity: 'error', text: 'Query B: timeout' },
      { severity: 'error', text: 'Bad gateway' },
    ]);
  });

  it('reads the single error of a query that threw, which is all Grafana sets then', () => {
    // runRequest's catchError on Grafana 13.3: `error` from toDataQueryError, no `errors`, and the
    // series of the panel's previous data (none on a first run).
    const threw = {
      message:
        'Features: no "19748:wfs:geonode:conae_no2_promedio_cba" in this catalog (it may have left it, or the data ' +
        "source's search no longer finds it): choose another",
    };

    expect(queryErrorNotices(undefined, threw)).toEqual([{ severity: 'error', text: threw.message }]);
    expect(queryErrorNotices([], { ...threw, refId: 'A' })).toEqual([
      { severity: 'error', text: `Query A: ${threw.message}` },
    ]);
  });

  it('reads the list alone when there is one, the single error being its first', () => {
    const first = { refId: 'A', message: 'down' };
    expect(queryErrorNotices([first, { refId: 'B', message: 'x' }], first)).toHaveLength(2);
  });

  it('says nothing without errors', () => {
    expect(queryErrorNotices(undefined)).toEqual([]);
    expect(queryErrorNotices([])).toEqual([]);
  });
});

describe('frameNotices', () => {
  const frame = (notices: Array<{ severity: 'info' | 'warning' | 'error'; text: string }>, name?: string) =>
    toDataFrame({
      refId: 'A',
      name,
      fields: [{ name: 'entry', type: FieldType.string, values: ['x'] }],
      meta: { notices },
    });

  it('keeps warnings and errors, named by their query, and leaves info notices to Grafana’s icon', () => {
    expect(
      frameNotices([
        frame(
          [
            { severity: 'warning', text: 'Cassini is no longer in the catalog.' },
            { severity: 'info', text: '12 features.' },
            { severity: 'error', text: 'This WFS does not publish that feature type.' },
          ],
          'services'
        ),
      ])
    ).toEqual([
      { severity: 'warning', text: 'services (query A): Cassini is no longer in the catalog.' },
      { severity: 'error', text: 'services (query A): This WFS does not publish that feature type.' },
    ]);
  });

  it('says nothing for frames without notices', () => {
    expect(frameNotices([toDataFrame({ refId: 'A', fields: [] })])).toEqual([]);
  });
});

describe('orderNotices', () => {
  it('puts errors first and says each thing once', () => {
    const warning = { severity: 'warning' as const, text: 'w' };
    const error = { severity: 'error' as const, text: 'e' };

    expect(orderNotices([warning, error], [warning])).toEqual([error, warning]);
  });
});

describe('undrawnServiceNotices', () => {
  /** A Spatial Catalog Services frame: every column on every row, empty where the service is another kind. */
  const services = (rows: Array<Record<string, string | null>>, refId = 'A') => {
    const columns = ['entry', 'title', 'service', 'url', 'layer', 'wms_url', 'wms_layer', 'tiles_url', 'esri_url'];
    return toDataFrame({
      refId,
      name: 'services',
      fields: [
        ...columns.map((name) => ({ name, type: FieldType.string, values: rows.map((row) => row[name] ?? null) })),
        { name: 'tiles_bbox', type: FieldType.string, values: rows.map(() => '-5.15 41.33 9.57 51.10') },
      ],
    });
  };
  /** IGN's elevation WMTS: its format is `image/x-bil`, not a picture, so the catalog gives no tile address. */
  const ELEVATION = {
    entry: 'ign-rge-alti',
    title: 'RGE ALTI',
    service: 'wmts',
    url: 'https://data.geopf.fr/wmts',
    layer: 'ELEVATION.ELEVATIONGRIDCOVERAGE',
  };

  it('says a service row that gives nothing this map draws, by its protocol and title', () => {
    expect(undrawnServiceNotices([services([ELEVATION])])).toEqual([
      {
        severity: 'warning',
        text:
          'services (query A) gives a WMTS service (RGE ALTI) with nothing this map draws: ' +
          'no tiles_url, no esri_url, no wms_url with its wms_layer.',
      },
    ]);
  });

  it("reads the protocol of a service written whole, as a Catalog search's rows give it", () => {
    const search = toDataFrame({
      refId: 'A',
      name: 'catalog',
      fields: [
        { name: 'entry', type: FieldType.string, values: ['dwd:Laender', 'dwd:Warnungen'] },
        { name: 'title', type: FieldType.string, values: ['Länder', 'Warnungen'] },
        {
          name: 'service',
          type: FieldType.string,
          values: [
            JSON.stringify({ styles: [], transparent: true, protocol: 'wms', layers: ['Laender'], dimensions: {} }),
            JSON.stringify({ protocol: 'wms', layers: ['Warnungen'] }),
          ],
        },
      ],
    });
    expect(undrawnServiceNotices([search])).toEqual([
      expect.objectContaining({
        text: expect.stringMatching(/^catalog \(query A\) gives a WMS service \(Länder\) with nothing this map draws/),
      }),
    ]);
    const nameless = toDataFrame({
      refId: 'B',
      fields: [{ name: 'service', type: FieldType.string, values: ['{"layers":["x"]}', '{not json'] }],
    });
    expect(undrawnServiceNotices([nameless])).toEqual([]);
  });

  it('says it too when the frame has no service columns at all', () => {
    const bare = toDataFrame({
      refId: 'B',
      fields: Object.entries(ELEVATION).map(([name, value]) => ({ name, type: FieldType.string, values: [value] })),
    });
    expect(undrawnServiceNotices([bare])).toEqual([
      expect.objectContaining({
        text: expect.stringMatching(/^Query B gives a WMTS service \(RGE ALTI\) with nothing/),
      }),
    ]);
  });

  it('says nothing when a row names a service the map draws', () => {
    const tiles = { ...ELEVATION, title: 'Plan IGN', tiles_url: 'https://data.geopf.fr/wmts/{z}/{x}/{y}.png' };
    const wms = { ...ELEVATION, service: 'wms', wms_url: 'https://data.geopf.fr/wms-r/wms', wms_layer: 'CASSINI' };
    const esri = { ...ELEVATION, service: 'esri', esri_url: 'https://x/arcgis/rest/services/A/MapServer' };
    expect(undrawnServiceNotices([services([ELEVATION, tiles]), services([wms], 'B'), services([esri], 'C')])).toEqual(
      []
    );
  });

  it('says nothing of rows the map draws by themselves, nor of a query with no protocol', () => {
    const placed = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'service', type: FieldType.string, values: ['bus'] },
        { name: 'latitude', type: FieldType.number, values: [-2.9] },
        { name: 'longitude', type: FieldType.number, values: [-79] },
      ],
    });
    expect(undrawnServiceNotices([placed, services([{ ...ELEVATION, service: null }], 'B')])).toEqual([]);
  });
});

describe('outOfRangeNotices', () => {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  /** Madrid's fountains, inspected from 2017 to 2025; one has no date. */
  const FOUNTAINS = {
    dataId: 'grafana-A',
    label: 'fountains',
    times: [day('2019-05-02'), day('2017-03-01'), null, day('2025-06-30')],
  };
  const LAST_7_DAYS = { from: day('2026-11-14'), to: day('2026-11-21') };

  it('says a query whose every row the range hides, with their span', () => {
    expect(outOfRangeNotices([FOUNTAINS], LAST_7_DAYS, iso)).toEqual([
      {
        severity: 'warning',
        text:
          "fountains (query A): its 3 rows all fall outside the dashboard's time range: they run from 2017-03-01 " +
          'to 2025-06-30. Widen the range to see them.',
      },
    ]);
  });

  it('says nothing once the range covers one of them, its ends included', () => {
    expect(outOfRangeNotices([FOUNTAINS], { from: day('2025-06-30'), to: day('2026-01-01') }, iso)).toEqual([]);
    expect(outOfRangeNotices([FOUNTAINS], { from: day('2010-01-01'), to: day('2017-03-01') }, iso)).toEqual([]);
    expect(outOfRangeNotices([FOUNTAINS], { from: day('2019-01-01'), to: day('2019-12-31') }, iso)).toEqual([]);
  });

  it('says it too when the range falls between the rows', () => {
    expect(outOfRangeNotices([FOUNTAINS], { from: day('2020-01-01'), to: day('2024-12-31') }, iso)).toHaveLength(1);
  });

  it('says nothing of a query with no timed row', () => {
    expect(
      outOfRangeNotices(
        [
          { ...FOUNTAINS, times: [] },
          { ...FOUNTAINS, times: [null] },
        ],
        LAST_7_DAYS,
        iso
      )
    ).toEqual([]);
  });

  it('names one row as one, and a query by its ref id when its frame has no name of its own', () => {
    expect(
      outOfRangeNotices([{ dataId: 'grafana-B', label: 'Query B', times: [day('2017-03-01')] }], LAST_7_DAYS, iso)
    ).toEqual([
      {
        severity: 'warning',
        text: "Query B: its one row, at 2017-03-01, falls outside the dashboard's time range. Widen the range to see it.",
      },
    ]);
  });

  it('hands the formatter the rows’ span, for it to choose how much of a moment to write', () => {
    const format = jest.fn((ms: number) => String(ms));
    outOfRangeNotices([{ ...FOUNTAINS, times: [1000, 4000] }], { from: 5000, to: 6000 }, format);
    expect(format).toHaveBeenCalledWith(1000, 3000);
  });
});
