import { dashboardAuthoringSkill, exampleMapConfig } from './authoringSkill';
import { datasetId } from '../data/framesToDatasets';
import { parseMapConfigJson } from '../data/mapConfig';

it('is within the skill byte budget and embeds the worked example verbatim', () => {
  expect(Buffer.byteLength(dashboardAuthoringSkill, 'utf8')).toBeLessThanOrEqual(32768);
  expect(dashboardAuthoringSkill).toContain('"version": "v1"');
  expect(dashboardAuthoringSkill).toContain(JSON.stringify(exampleMapConfig, null, 1));
});

it('ships an example the panel itself accepts, with the nesting kepler needs', () => {
  const parsed = parseMapConfigJson(JSON.stringify(exampleMapConfig));
  expect(parsed).not.toBeNull();
  expect(parsed?.version).toBe('v1');

  const layer = exampleMapConfig.config.visState.layers[0] as Record<string, unknown>;
  const layerConfig = layer.config as Record<string, unknown>;
  // kepler reads visualChannels as a SIBLING of config — inside config it is
  // silently dropped and the layer falls back to the default colour.
  expect(layer.visualChannels).toBeDefined();
  expect(layerConfig.visualChannels).toBeUndefined();
  expect(layerConfig.dataId).toBe(datasetId('A'));
});

it('states the traps the spike caught: version rule, absolute time, reload', () => {
  expect(dashboardAuthoringSkill).toContain('silently ignore');
  expect(dashboardAuthoringSkill).toContain('absolute');
  expect(dashboardAuthoringSkill).toContain('reload');
});
