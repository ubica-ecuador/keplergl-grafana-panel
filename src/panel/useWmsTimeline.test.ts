import { renderHook } from '@testing-library/react';
import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToWms, type WmsDataset } from '../data/wmsDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { loadWms, pushTimeRange, readTimeRange, refreshWms } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { earlierWithin, useWmsTimeline } from './useWmsTimeline';

/** A query's WMS layer turned into another of the same service, on kepler's real store. */

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const hour = (day: number, h: number) => Date.UTC(2026, 10, day, h);

/** DWD's layer as the Spatial Catalog's Services query gives it, with the dates its capabilities publish. */
function dwd(layer: string, times: number[]): WmsDataset {
  const [wms] = framesToWms([
    toDataFrame({
      refId: 'A',
      fields: [
        // A GeoServer's layer by its own endpoint, as the catalog gives it.
        { name: 'wms_url', type: FieldType.string, values: [`https://maps.dwd.de/geoserver/dwd/${layer}/ows`] },
        { name: 'wms_layer', type: FieldType.string, values: [layer] },
      ],
    }),
  ]);
  return { ...wms, times };
}

const chosenLayer = (store: Store) =>
  (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState.layers[0]?.config.visConfig.wmsLayer?.name;

describe('useWmsTimeline', () => {
  it('pins the layer a query names, and the next one it names, opening the clock on its dates', async () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    const satellite = dwd('Satellite_meteosat', [hour(22, 6), hour(23, 15)]);
    const wind = dwd('Aicon_reg025_fd_sl_UV10M', [hour(22, 6), hour(25, 0), hour(30, 21)]);

    loadWms(store.dispatch, [satellite]);
    await settle();
    const { rerender } = renderHook(
      ({ layers }: { layers: WmsDataset[] }) => useWmsTimeline({ store, isReady: true, layers, timeVariables: null }),
      { initialProps: { layers: [satellite] } }
    );
    await settle();
    expect(chosenLayer(store)).toBe('Satellite_meteosat');

    // The same query, now naming AICON's wind: the dataset keeps its id, and kepler the layer it had. Not asked
    // at the satellite's address, where the service does not know it, before the dataset is the wind's.
    rerender({ layers: [wind] });
    await settle();
    expect(chosenLayer(store)).toBe('Satellite_meteosat');
    refreshWms(store, store.dispatch, [wind]);
    await settle();
    expect(chosenLayer(store)).toBe('Aicon_reg025_fd_sl_UV10M');
    expect(readTimeRange(store)).toEqual({ from: hour(22, 6), to: hour(30, 21) });
  });

  it('leaves the window the dashboard range put when the dates change, if the range drives the map', async () => {
    const run = async (followsDashboard: boolean) => {
      const store = createKeplerStore();
      store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
      const before = dwd('Aicon_reg025_fd_sl_UV10M', [hour(22, 6), hour(25, 0), hour(30, 21)]);
      // The dates of another range: the calendar a dashboard range years back reads (useWmsCalendar).
      const after = { ...before, times: [hour(24, 0), hour(25, 0), hour(26, 0)] };
      loadWms(store.dispatch, [before]);
      await settle();
      const { rerender } = renderHook(
        ({ layers }: { layers: WmsDataset[] }) =>
          useWmsTimeline({ store, isReady: true, layers, timeVariables: null, followsDashboard }),
        { initialProps: { layers: [before] } }
      );
      await settle();
      // The range sync puts the dashboard's window.
      pushTimeRange(store, store.dispatch, { from: hour(24, 12), to: hour(25, 12) });
      refreshWms(store, store.dispatch, [after]);
      rerender({ layers: [after] });
      await settle();
      return readTimeRange(store);
    };

    expect(await run(true)).toEqual({ from: hour(24, 12), to: hour(25, 12) });
    // A map with a clock of its own opens on the new dates, as before.
    expect(await run(false)).toEqual({ from: hour(24, 0), to: hour(26, 0) });
  });
});

describe('earlierWithin', () => {
  it('gives the dates before the moment in the window, latest first, three at most', () => {
    const times = [hour(30, 17), hour(30, 18), hour(30, 19), hour(30, 20), hour(30, 21), hour(30, 22), hour(30, 23)];
    expect(earlierWithin(times, hour(30, 23), { from: hour(30, 18), to: hour(30, 23) })).toEqual([
      '2026-11-30T22:00:00.000Z',
      '2026-11-30T21:00:00.000Z',
      '2026-11-30T20:00:00.000Z',
    ]);
    expect(earlierWithin(times, hour(30, 19), { from: hour(30, 18), to: hour(30, 20) })).toEqual([
      '2026-11-30T18:00:00.000Z',
    ]);
  });
});
