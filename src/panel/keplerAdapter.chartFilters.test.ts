import type { Store } from 'redux';
import { createOrUpdateFilter, removeFilter, wrapTo } from '@kepler.gl/actions';

import { KEPLER_INSTANCE_ID } from './constants';
import {
  applyFieldFilter,
  capturePlayingTimeFilter,
  ensureTimeFilter,
  isTimeFilterAnimating,
  pushTimeRange,
  readFilters,
  readParkedFilters,
  readTimeRange,
  removeFieldFilter,
} from './keplerAdapter';

/**
 * The syncs read kepler's filters through the adapter; a chart's cross-filter
 * must never be one of them. The chart's filters are listed *first* in these
 * stores on purpose: the time helpers take the first `timeRange` they find, so
 * a chart's filter ahead of the map's own is exactly what used to win.
 */

const CHART = { id: 'c1', crossFilter: { enabled: true, filterId: 'bars', fieldNames: {}, value: {} } };
const CHART_TIME = {
  id: 'bars',
  type: 'timeRange',
  name: ['time'],
  dataId: ['grafana-A'],
  value: [10, 20],
  domain: [0, 100],
  isAnimating: false,
};
const CHART_SITE = { id: 'bars-x', type: 'multiSelect', name: ['site'], dataId: ['grafana-A'], value: ['norte'] };
const OWN_TIME = {
  id: 'reloj',
  type: 'timeRange',
  name: ['time'],
  dataId: ['grafana-A'],
  value: [30, 40],
  domain: [0, 100],
  isAnimating: true,
};
const OWN_SITE = { id: 'sitio', type: 'multiSelect', name: ['site'], dataId: ['grafana-A'], value: ['sur'] };

function store(visState: Record<string, unknown>): Store {
  return {
    getState: () => ({
      keplerGl: {
        [KEPLER_INSTANCE_ID]: {
          visState: {
            datasets: {
              'grafana-A': {
                fields: [
                  { name: 'time', type: 'timestamp' },
                  { name: 'site', type: 'string' },
                ],
              },
            },
            layers: [],
            filters: [],
            ...visState,
          },
        },
      },
    }),
  } as unknown as Store;
}

const ids = (filters: Array<{ id?: string; name?: unknown }>) => filters.map((f) => f.id);

describe('the variable sync’s filter reads', () => {
  it('leave out the filters a chart owns', () => {
    const s = store({ filters: [CHART_TIME, OWN_SITE, CHART_SITE], charts: [CHART] });
    expect(ids(readFilters(s))).toEqual(['sitio']);
  });

  it('read chart ids from a chart parked by a refresh', () => {
    const s = store({ filters: [CHART_SITE, OWN_SITE], charts: [], chartsToBeMerged: [CHART] });
    expect(ids(readFilters(s))).toEqual(['sitio']);
  });

  it('leave a chart’s parked filter out of the parked ones too', () => {
    const s = store({ filterToBeMerged: [CHART_SITE, OWN_SITE], chartsToBeMerged: [CHART] });
    expect(ids(readParkedFilters(s))).toEqual(['sitio']);
  });

  it('create the map’s own filter when only a chart’s is on the field', () => {
    const dispatch = jest.fn();
    const s = store({ filters: [CHART_SITE], charts: [CHART] });

    expect(applyFieldFilter(s, dispatch, 'site', ['sur'])).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(undefined, 'grafana-A', 'site', ['sur']))
    );
  });

  it('remove the map’s own filter, by its place in kepler’s list', () => {
    const dispatch = jest.fn();
    removeFieldFilter(store({ filters: [CHART_SITE, OWN_SITE], charts: [CHART] }), dispatch, 'site');
    expect(dispatch).toHaveBeenCalledWith(wrapTo(KEPLER_INSTANCE_ID, removeFilter(1)));
  });

  it('never remove a chart’s filter', () => {
    const dispatch = jest.fn();
    removeFieldFilter(store({ filters: [CHART_SITE], charts: [CHART] }), dispatch, 'site');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('the time sync’s filter reads', () => {
  it('read the map’s own clock when a chart’s time filter comes first', () => {
    expect(readTimeRange(store({ filters: [CHART_TIME, OWN_TIME], charts: [CHART] }))).toEqual({ from: 30, to: 40 });
  });

  it('see no clock when the only time filter is a chart’s', () => {
    expect(readTimeRange(store({ filters: [CHART_TIME], charts: [CHART] }))).toBeNull();
  });

  it('report the map’s own clock playing, not the chart’s', () => {
    expect(isTimeFilterAnimating(store({ filters: [CHART_TIME, OWN_TIME], charts: [CHART] }))).toBe(true);
  });

  it('create the map’s own time filter beside a chart’s', () => {
    const dispatch = jest.fn();
    expect(ensureTimeFilter(store({ filters: [CHART_TIME], charts: [CHART] }), dispatch)).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter(undefined, 'grafana-A', 'time'))
    );
  });

  it('move the map’s own time filter, not the chart’s', () => {
    const dispatch = jest.fn();
    pushTimeRange(store({ filters: [CHART_TIME, OWN_TIME], charts: [CHART] }), dispatch, { from: 50, to: 60 });
    expect(dispatch).toHaveBeenCalledWith(
      wrapTo(KEPLER_INSTANCE_ID, createOrUpdateFilter('reloj', undefined, undefined, [50, 60]))
    );
  });

  it('catch the map’s own clock playing before a refresh', () => {
    const s = store({ filters: [CHART_TIME, OWN_TIME], charts: [CHART] });
    expect(capturePlayingTimeFilter(s, [{ id: 'grafana-A' }] as never)).toEqual({ id: 'reloj', value: [30, 40] });
  });
});
