import { parseMapConfigJson } from './mapConfig';

describe('parseMapConfigJson', () => {
  it('parses a kepler saved-config wrapper', () => {
    const saved = { version: 'v1', config: { visState: { layers: [] } } };

    expect(parseMapConfigJson(JSON.stringify(saved))).toEqual(saved);
  });

  it('unwraps a full exported map, keeping only the config', () => {
    // kepler's "Export map" and Dekart both hand out {datasets, config, info}.
    // Only the config half is meaningful here — the data comes from the queries.
    const exported = {
      datasets: [{ version: 'v1', data: { id: 'x', allData: [[1, 2]] } }],
      config: { version: 'v1', config: { visState: { layers: [] } } },
      info: { app: 'kepler.gl' },
    };

    expect(parseMapConfigJson(JSON.stringify(exported))).toEqual(exported.config);
  });

  it('returns null for anything that is not a config', () => {
    for (const input of ['', 'not json', '[]', 'null', '42', '{"nope":1}']) {
      expect(parseMapConfigJson(input)).toBeNull();
    }
  });
});
