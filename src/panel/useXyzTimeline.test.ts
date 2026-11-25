import { renderHook } from '@testing-library/react';
import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToXyz } from '../data/xyzDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { loadXyz, pushTimeRange, syncCalendarDataset } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { useXyzTimeline } from './useXyzTimeline';

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const gibs = (d: string) => `https://gibs.test/MODIS/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
const DAYS = ['2025-01-10', '2025-01-11', '2025-01-13'];
const frame = toDataFrame({
  refId: 'A',
  fields: [
    { name: 'time', type: FieldType.time, values: DAYS.map(day) },
    { name: 'tiles_url', type: FieldType.string, values: DAYS.map(gibs) },
    { name: 'tiles_format', type: FieldType.string, values: DAYS.map(() => 'raster') },
  ],
});

const drawn = (store: Store) => {
  const layer = (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState.layers.find(
    (l: any) => l.config.dataId === 'grafana-A-tiles'
  );
  return { url: layer?.config.visConfig.xyzUrl, visible: layer?.config.isVisible };
};

describe('useXyzTimeline', () => {
  it('draws the tiles of the date the window holds, else the date before it, and none before every date', async () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    const [xyz] = framesToXyz([frame]);
    // The query's rows (a row per date, its time) and its tiles, as the map loads them.
    syncCalendarDataset(store, store.dispatch, { id: 'grafana-A', label: 'MODIS', times: DAYS.map(day) });
    loadXyz(store.dispatch, [xyz]);
    await settle();
    renderHook(() =>
      useXyzTimeline({ store, isReady: true, layers: [xyz], timeVariables: null, followsDashboard: true })
    );
    await settle();

    pushTimeRange(store, store.dispatch, { from: day('2025-01-11'), to: day('2025-01-11') + 3_600_000 });
    await settle();
    expect(drawn(store)).toEqual({ url: gibs('2025-01-11'), visible: true });

    // 12 January has no tiles: the 11th's still stand.
    pushTimeRange(store, store.dispatch, { from: day('2025-01-12'), to: day('2025-01-12') + 3_600_000 });
    await settle();
    expect(drawn(store).url).toBe(gibs('2025-01-11'));

    pushTimeRange(store, store.dispatch, { from: day('2025-01-01'), to: day('2025-01-02') });
    await settle();
    expect(drawn(store).visible).toBe(false);
  });
});
