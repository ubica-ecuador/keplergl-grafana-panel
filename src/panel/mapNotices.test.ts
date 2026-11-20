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
