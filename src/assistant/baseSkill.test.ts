import { baseAssistantSkill } from './baseSkill';

it('is within the skill byte budget and covers the free schema', () => {
  expect(Buffer.byteLength(baseAssistantSkill, 'utf8')).toBeLessThanOrEqual(32768);
  expect(baseAssistantSkill).toContain('config.mapStyle.styleType');
  expect(baseAssistantSkill).toContain('dark-matter');
  expect(baseAssistantSkill).toContain('clickArea');
});
