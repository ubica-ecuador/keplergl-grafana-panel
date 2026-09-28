import KeplerGlSchema from '@kepler.gl/schemas';

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

describe('loadDatasets — a saved compare mode survives the load', () => {
  it('dispatches INTERACTION_CONFIG_CHANGE with the saved compareMode, after addDataToMap', () => {
    const dispatch = jest.fn();
    const config = savedConfig({
      enabled: true,
      compareMode: true,
      compareType: 'absolute',
      fieldsToShow: FIELDS_TO_SHOW,
    });

    loadDatasets(dispatch, [], {}, config as never);

    expect(dispatch).toHaveBeenCalledTimes(2);
    const [addDataToMapCall, interactionCall] = dispatch.mock.calls;
    expect(addDataToMapCall[0].payload.type).toBe('@@kepler.gl/ADD_DATA_TO_MAP');
    expect(interactionCall[0].payload).toMatchObject({
      type: '@@kepler.gl/INTERACTION_CONFIG_CHANGE',
      config: {
        id: 'tooltip',
        enabled: true,
        config: {
          fieldsToShow: FIELDS_TO_SHOW,
          compareMode: true,
          compareType: 'absolute',
        },
      },
    });
  });

  it('dispatches nothing extra for a saved config without compareMode', () => {
    const dispatch = jest.fn();
    const config = savedConfig({ enabled: true, fieldsToShow: FIELDS_TO_SHOW });

    loadDatasets(dispatch, [], {}, config as never);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('dispatches nothing extra with no saved config at all', () => {
    const dispatch = jest.fn();

    loadDatasets(dispatch, [], {});

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
