import type { PanelModel } from '@grafana/data';

import { hasRemovedOptions, migrateRemovedOptions, withoutRemovedOptions } from './removedOptions';

const saved = (options: Record<string, unknown>): PanelModel =>
  ({
    id: 1,
    type: 'ubica-keplergl-panel',
    pluginVersion: '1.6.2',
    options,
    fieldConfig: { defaults: {}, overrides: [] },
  }) as PanelModel;

describe('the CARTO API key a panel saved up to 1.6', () => {
  it('is dropped by the migration, and every other option kept', () => {
    const options = { basemap: 'positron', cartoApiKey: 'secret', mapConfig: { version: 'v1', config: {} } };

    const migrated = migrateRemovedOptions(saved(options));

    expect(migrated).toEqual({ basemap: 'positron', mapConfig: { version: 'v1', config: {} } });
    expect('cartoApiKey' in migrated).toBe(false);
    // The panel's own object is left as it was.
    expect(options.cartoApiKey).toBe('secret');
  });

  it('asks for a migration whatever version saved the panel, and only when the key is there', () => {
    expect(hasRemovedOptions(saved({ cartoApiKey: '' }))).toBe(true);
    expect(hasRemovedOptions(saved({ basemap: 'positron' }))).toBe(false);
    expect(hasRemovedOptions({ options: undefined } as unknown as PanelModel)).toBe(false);
  });

  it('leaves options without it untouched', () => {
    const options = { basemap: 'positron' };
    expect(withoutRemovedOptions(options)).toBe(options);
    expect(migrateRemovedOptions({ ...saved({}), options: undefined } as unknown as PanelModel)).toEqual({});
  });
});

describe('the options of 1.9 that go or move into each query', () => {
  it('drops Flow line style: a saved map’s flow layers keep their own', () => {
    const migrated = migrateRemovedOptions(saved({ flowRenderMode: 'curved', basemap: 'positron' }));
    expect(migrated).toEqual({ basemap: 'positron' });
  });

  it('moves a panel-wide Trip layer shape and gazetteer to the entry every query takes', () => {
    const migrated = migrateRemovedOptions(
      saved({ tripLayerMode: 'geojson', gazetteer: 'public/gazetteer/airports.geojson', queryOptions: { B: {} } })
    );
    expect(migrated).toEqual({
      queryOptions: { B: {}, '*': { tripLayerMode: 'geojson', gazetteer: 'public/gazetteer/airports.geojson' } },
    });
  });

  it('drops the defaults Grafana saved into every panel, with nothing to carry', () => {
    const migrated = migrateRemovedOptions(
      saved({ tripLayerMode: 'table', gazetteer: 'public/gazetteer/countries.json', flowRenderMode: 'straight' })
    );
    expect(migrated).toEqual({});
  });

  it('asks for a migration whenever one of them is there', () => {
    for (const key of ['flowRenderMode', 'tripLayerMode', 'gazetteer']) {
      expect(hasRemovedOptions(saved({ [key]: 'x' }))).toBe(true);
    }
    expect(hasRemovedOptions(saved({ queryOptions: { '*': { tripLayerMode: 'geojson' } } }))).toBe(false);
  });
});
