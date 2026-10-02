import { baseAssistantSkill } from './baseSkill';
import { datasetId } from '../data/framesToDatasets';
import { registeredMapStyles } from '../panel/basemaps';

it('is within the skill byte budget and covers the free schema', () => {
  expect(Buffer.byteLength(baseAssistantSkill, 'utf8')).toBeLessThanOrEqual(32768);
  expect(baseAssistantSkill).toContain('config.mapStyle.styleType');
  expect(baseAssistantSkill).toContain('openfreemap-dark');
  expect(baseAssistantSkill).toContain('dark-matter');
  expect(baseAssistantSkill).toContain('clickArea');
});

it('documents the grafana-<refId> dataId convention', () => {
  expect(datasetId('B')).toBe('grafana-B');
  expect(baseAssistantSkill).toContain('grafana-<refId>');
});

it('names only base-map ids the panel actually registers', () => {
  // Derived from the panel's own basemaps module rather than a hand-copied
  // literal, so a future basemap change fails this test instead of leaving
  // the skill teaching an id the picker does not offer (e.g. kepler's own
  // `satellite`, a Mapbox style that blanks the map without a token).
  const match = baseAssistantSkill.match(/Free ids:\s*([\s\S]*?)\./);
  expect(match).not.toBeNull();
  const namedIds = (match as RegExpMatchArray)[1].split(',').map((id) => id.trim());
  const registeredIds = registeredMapStyles().map((s) => s.id);

  expect(namedIds.length).toBeGreaterThan(0);
  for (const id of namedIds) {
    expect(registeredIds).toContain(id);
  }
});

it('points the colour ramp at the real config path', () => {
  expect(baseAssistantSkill).toContain('layer.config.visConfig.colorRange');
});
