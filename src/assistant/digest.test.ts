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

it('falls back to the resolved base map id when no mapConfig is saved (fresh panel default)', () => {
  const d = buildAssistantDigest({
    series: [],
    timeRange: { from: 't0', to: 't1' },
    baseMapId: 'dark-matter',
  } as any);
  expect(d.datasets).toEqual([]);
  expect(d.filters).toEqual([]);
  expect(d.baseMap).toEqual({ id: 'dark-matter' });
});

it('falls back to the resolved base map id when the saved styleType is an empty string', () => {
  const d = buildAssistantDigest({
    series: [],
    mapConfig: { config: { mapStyle: { styleType: '' } } },
    timeRange: { from: 't0', to: 't1' },
    baseMapId: 'positron',
  } as any);
  expect(d.baseMap).toEqual({ id: 'positron' });
});

it('prefers the saved styleType over the resolved base map id when both are present', () => {
  const d = buildAssistantDigest({
    series: [],
    mapConfig: { config: { mapStyle: { styleType: 'voyager' } } },
    timeRange: { from: 't0', to: 't1' },
    baseMapId: 'positron',
  } as any);
  expect(d.baseMap).toEqual({ id: 'voyager' });
});

it('falls back a missing refId to the same grafana-<index> convention framesToDatasets uses', () => {
  const d = buildAssistantDigest({
    series: [
      { name: 'first', length: 3, fields: [] },
      { refId: 'B', name: 'second', length: 5, fields: [] },
    ],
    timeRange: { from: 't0', to: 't1' },
  } as any);
  expect(d.datasets[0].refId).toBe('0');
  expect(d.datasets[1].refId).toBe('B');
});
