import { FieldType, toDataFrame } from '@grafana/data';

import { frameNotices, orderNotices, queryErrorNotices } from './mapNotices';

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
