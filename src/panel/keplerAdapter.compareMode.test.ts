import KeplerGlSchema from '@kepler.gl/schemas';

import { KEPLER_INSTANCE_ID } from './constants';
import { loadDatasets, savedTooltipCompare } from './keplerAdapter';

/**
 * A saved config shaped like `provisioning/dashboards/charts.json`'s
 * `interactionConfig.tooltip`: `compareMode: true` alongside `fieldsToShow`.
 * Real `KeplerGlSchema.parseSavedConfig` is what actually decides the parsed
 * shape `savedTooltipCompare` has to read — see the brief's warning that the
 * schema might keep `compareMode` at `tooltip.compareMode` or nested under
 * `tooltip.config`. Probed live: it stays flat, `InteractionSchemaV1.load`
 * being a plain `cloneDeep`.
 */
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
      mapState: { isSplit: false, latitude: 0, longitude: 0, zoom: 2 },
      mapStyle: {},
    },
  };
}

const FIELDS_TO_SHOW = { 'grafana-A': [{ name: 'site', format: null }] };

describe('savedTooltipCompare', () => {
  it('reads compareMode and compareType off a real parsed config', () => {
    const parsed = KeplerGlSchema.parseSavedConfig(
      savedConfig({ enabled: true, compareMode: true, compareType: 'absolute', fieldsToShow: FIELDS_TO_SHOW }) as never
    );

    expect(savedTooltipCompare(parsed)).toEqual({ compareMode: true, compareType: 'absolute' });
  });

  it('returns null when the saved tooltip never states compareMode', () => {
    const parsed = KeplerGlSchema.parseSavedConfig(
      savedConfig({ enabled: true, fieldsToShow: FIELDS_TO_SHOW }) as never
    );

    expect(savedTooltipCompare(parsed)).toBeNull();
  });

  it('returns null for no config at all', () => {
    expect(savedTooltipCompare(null)).toBeNull();
  });
});

/**
 * A store holding the tooltip item `addDataToMap` leaves behind on a first
 * load: kepler's reset default, whose `fieldsToShow` only names datasets that
 * merged synchronously — none here, since no dataset has settled yet.
 */
function storeWithTooltip(tooltip: Record<string, unknown>) {
  return {
    getState: () => ({ keplerGl: { [KEPLER_INSTANCE_ID]: { visState: { interactionConfig: { tooltip } } } } }),
  };
}

const LIVE_TOOLTIP = {
  id: 'tooltip',
  label: 'interactions.tooltip',
  enabled: true,
  config: { fieldsToShow: {}, compareMode: false, compareType: 'absolute' },
};

describe('loadDatasets — a saved compare mode survives the load', () => {
  it('dispatches INTERACTION_CONFIG_CHANGE with the saved compareMode, after addDataToMap', () => {
    const dispatch = jest.fn();
    const config = savedConfig({
      enabled: true,
      compareMode: true,
      compareType: 'relative',
      fieldsToShow: FIELDS_TO_SHOW,
    });

    loadDatasets(storeWithTooltip(LIVE_TOOLTIP) as never, dispatch, [], {}, config as never);

    expect(dispatch).toHaveBeenCalledTimes(2);
    const [addDataToMapCall, interactionCall] = dispatch.mock.calls;
    expect(addDataToMapCall[0].payload.type).toBe('@@kepler.gl/ADD_DATA_TO_MAP');
    expect(interactionCall[0].payload).toMatchObject({
      type: '@@kepler.gl/INTERACTION_CONFIG_CHANGE',
      config: {
        id: 'tooltip',
        label: 'interactions.tooltip',
        enabled: true,
        config: { compareMode: true, compareType: 'relative' },
      },
    });
  });

  it('builds the item from the live tooltip, never carrying a saved fieldsToShow for a dataset that never loads', () => {
    // The saved `fieldsToShow` names `grafana-A`, which never loads. Were it
    // carried into the store, kepler's later merge would keep it for good and
    // Interactions -> Tooltip would read `datasets['grafana-A'].fields`.
    const dispatch = jest.fn();
    const live = {
      ...LIVE_TOOLTIP,
      config: { ...LIVE_TOOLTIP.config, fieldsToShow: { 'grafana-B': [{ name: 'depth', format: null }] } },
    };
    const config = savedConfig({ enabled: true, compareMode: true, fieldsToShow: FIELDS_TO_SHOW });

    loadDatasets(storeWithTooltip(live) as never, dispatch, [], {}, config as never);

    const item = dispatch.mock.calls[1][0].payload.config;
    expect(item.config.fieldsToShow).not.toHaveProperty('grafana-A');
    expect(item.config.fieldsToShow).toEqual({ 'grafana-B': [{ name: 'depth', format: null }] });
    expect(item.config.compareType).toBe('absolute');
  });

  it("dispatches nothing extra for a saved compareMode: false, kepler's own default", () => {
    // kepler's "Save current map" always writes `compareMode`, so `false` is
    // what nearly every saved map carries.
    const dispatch = jest.fn();
    const config = savedConfig({ enabled: true, compareMode: false, fieldsToShow: FIELDS_TO_SHOW });

    loadDatasets(storeWithTooltip(LIVE_TOOLTIP) as never, dispatch, [], {}, config as never);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('dispatches nothing extra for a saved config without compareMode', () => {
    const dispatch = jest.fn();
    const config = savedConfig({ enabled: true, fieldsToShow: FIELDS_TO_SHOW });

    loadDatasets(storeWithTooltip(LIVE_TOOLTIP) as never, dispatch, [], {}, config as never);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('dispatches nothing extra with no saved config at all', () => {
    const dispatch = jest.fn();

    loadDatasets(storeWithTooltip(LIVE_TOOLTIP) as never, dispatch, [], {});

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
