import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry } from '@kepler.gl/actions';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { loadDatasets } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

jest.mock('@grafana/runtime', () => ({}));

/**
 * A saved map's tooltip compare setting reaches the store through kepler's own
 * merge. Until kepler.gl 3.3.0-alpha.20 (keplergl/kepler.gl#3978) its
 * `mergeInteractions` rebuilt the tooltip's config from `fieldsToShow` and the
 * time zone alone, and the panel put `compareMode`/`compareType` back after
 * `addDataToMap` itself. This pins the upstream behaviour the panel now relies
 * on: the provisioned charts dashboard saves `compareMode: true`.
 */

/** kepler's data pipeline settles on the task middleware's promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function sites() {
  return framesToDatasets([
    toDataFrame({
      refId: 'A',
      fields: [
        { name: 'site', type: FieldType.string, values: ['north', 'south'] },
        { name: 'latitude', type: FieldType.number, values: [-2.8, -2.9] },
        { name: 'longitude', type: FieldType.number, values: [-79, -79] },
      ],
    }),
  ]);
}

function savedConfig(tooltip: Record<string, unknown>) {
  return {
    version: 'v1',
    config: {
      visState: {
        layers: [],
        filters: [],
        interactionConfig: { tooltip },
        splitMaps: [],
      },
      mapState: { isSplit: false, latitude: -2.85, longitude: -79, zoom: 9 },
      mapStyle: {},
    },
  };
}

function mapStore() {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  return store;
}

function tooltipConfig(store: ReturnType<typeof createKeplerStore>) {
  return store.getState().keplerGl[KEPLER_INSTANCE_ID].visState.interactionConfig.tooltip.config;
}

describe('loadDatasets — a saved tooltip compare mode', () => {
  it('is kept by kepler, with its compare type', async () => {
    const store = mapStore();
    const config = savedConfig({
      enabled: true,
      compareMode: true,
      compareType: 'relative',
      fieldsToShow: { 'grafana-A': [{ name: 'site', format: null }] },
    });

    loadDatasets(store, store.dispatch, sites(), {}, config as never);
    await settle();

    expect(tooltipConfig(store)).toMatchObject({ compareMode: true, compareType: 'relative' });
  });

  it('stays off for a map saved without it', async () => {
    const store = mapStore();
    const config = savedConfig({ enabled: true, fieldsToShow: { 'grafana-A': [{ name: 'site', format: null }] } });

    loadDatasets(store, store.dispatch, sites(), {}, config as never);
    await settle();

    expect(tooltipConfig(store).compareMode).toBe(false);
  });
});
