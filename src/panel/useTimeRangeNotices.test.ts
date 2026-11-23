import { act, renderHook } from '@testing-library/react';
import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToDatasets } from '../data/framesToDatasets';
import { framesToWms } from '../data/wmsDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import {
  ensureTimeFilter,
  loadDatasets,
  loadWms,
  pushTimeRange,
  readTimeFilterTimes,
  setRasterLayerVisible,
  syncWmsCalendar,
} from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import type { TimeRangeMs, TimeSyncMode } from './timeSync';
import { useTimeRangeNotices } from './useTimeRangeNotices';

/**
 * The notice over a map whose time filter, following the dashboard's range,
 * hides every row of a query. On kepler's real store.
 */

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const LAST_7_DAYS: TimeRangeMs = { from: day('2026-11-14'), to: day('2026-11-21') };

/** Madrid's fountains, inspected from 2017 to 2025, filtered by the dashboard's last seven days. */
async function fountains(): Promise<Store> {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  const datasets = framesToDatasets([
    toDataFrame({
      refId: 'A',
      name: 'fountains',
      fields: [
        { name: 'inspected', type: FieldType.time, values: [day('2017-03-01'), day('2021-08-15'), day('2025-06-30')] },
        { name: 'latitude', type: FieldType.number, values: [40.41, 40.42, 40.43] },
        { name: 'longitude', type: FieldType.number, values: [-3.7, -3.71, -3.72] },
      ],
    }),
  ]);
  loadDatasets(store, store.dispatch, datasets);
  await settle();
  pushTimeRange(store, store.dispatch, LAST_7_DAYS);
  await settle();
  return store;
}

describe('useTimeRangeNotices', () => {
  it('reads the times the map’s time filter filters, by dataset', async () => {
    const store = await fountains();
    expect(readTimeFilterTimes(store)).toEqual([
      { dataId: 'grafana-A', label: 'fountains', times: [day('2017-03-01'), day('2021-08-15'), day('2025-06-30')] },
    ]);
  });

  it('says the rows the range hides, and goes when it covers some again', async () => {
    const store = await fountains();
    const { result, rerender } = renderHook(
      ({ range, mode }: { range: TimeRangeMs; mode: TimeSyncMode }) =>
        useTimeRangeNotices({ store, isReady: true, mode, grafanaRange: range, timeZone: 'utc' }),
      { initialProps: { range: LAST_7_DAYS, mode: 'toMap' as TimeSyncMode } }
    );
    await act(settle);
    expect(result.current).toEqual([
      {
        severity: 'warning',
        text:
          "fountains (query A): its 3 rows all fall outside the dashboard's time range: they run from 2017-03-01 " +
          'to 2025-06-30. Widen the range to see them.',
      },
    ]);

    rerender({ range: { from: day('2025-01-01'), to: LAST_7_DAYS.to }, mode: 'toMap' });
    await act(settle);
    expect(result.current).toEqual([]);

    // A map whose filter does not follow the dashboard's range is not hiding anything by it.
    rerender({ range: LAST_7_DAYS, mode: 'variables' });
    await act(settle);
    expect(result.current).toEqual([]);
  });
  it('says the dates of a WMS its timeline turned off, none in the range', async () => {
    // DWD's satellite picture every 3 hours, kept for a day and a half, under a week of October.
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    const [wms] = framesToWms([
      toDataFrame({
        refId: 'A',
        name: 'services',
        fields: [
          { name: 'title', type: FieldType.string, values: ['Satellitenbild'] },
          { name: 'wms_url', type: FieldType.string, values: ['https://maps.dwd.de/geoserver/ows'] },
          { name: 'wms_layer', type: FieldType.string, values: ['dwd:Satellite_meteosat'] },
        ],
      }),
    ]);
    loadWms(store.dispatch, [wms]);
    await settle();
    syncWmsCalendar(store, store.dispatch, {
      ...wms,
      times: [Date.UTC(2026, 10, 22, 3), Date.UTC(2026, 10, 23, 12)],
    });
    await settle();
    ensureTimeFilter(store, store.dispatch);
    const october: TimeRangeMs = { from: day('2026-10-25'), to: day('2026-10-31') };
    pushTimeRange(store, store.dispatch, october);
    setRasterLayerVisible(store, store.dispatch, wms.id, false);
    await settle();

    const { result } = renderHook(() =>
      useTimeRangeNotices({ store, isReady: true, mode: 'toMap', grafanaRange: october, timeZone: 'utc' })
    );
    await act(settle);
    expect(result.current).toEqual([
      {
        severity: 'warning',
        text:
          "Satellitenbild (query A): its 2 dates all fall outside the dashboard's time range: they run from " +
          '2026-11-22 03:00 to 2026-11-23 12:00. Widen the range to see them.',
      },
    ]);
  });
});
