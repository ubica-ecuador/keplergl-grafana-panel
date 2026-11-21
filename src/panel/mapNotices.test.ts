import { FieldType, toDataFrame } from '@grafana/data';

import { frameNotices, orderNotices, queryErrorNotices, undrawnServiceNotices } from './mapNotices';

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
