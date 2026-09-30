import { buildAssistantDigest } from './digest';

it('always carries the time range and dataset fields', () => {
  const d = buildAssistantDigest({
    series: [{ refId: 'A', name: 'gps', length: 10, fields: [{ name: 'lat', type: 'number' }] }],
    mapConfig: { config: { mapStyle: { styleType: 'dark-matter' } } },
    timeRange: { from: 't0', to: 't1' },
  } as any);
  expect(d.timeRange).toEqual({ from: 't0', to: 't1' });
  expect(d.baseMap).toEqual({ id: 'dark-matter' });
  expect(d.datasets[0]).toMatchObject({ refId: 'A', name: 'gps', rowCount: 10 });
});
