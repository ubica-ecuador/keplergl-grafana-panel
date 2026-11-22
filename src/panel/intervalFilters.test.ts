import { registerEntry, removeFilter, setFilter, wrapTo } from '@kepler.gl/actions';
import { getFilterFunction } from '@kepler.gl/utils';
import { FieldType, toDataFrame } from '@grafana/data';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { loadDatasets, pushTimeRange, readFilters } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

const JAN = Date.parse('2026-01-15T09:00:00Z');
const MAR = Date.parse('2026-03-10T09:00:00Z');
const MAY = Date.parse('2026-05-20T09:00:00Z');
const APR = Date.parse('2026-04-01T00:00:00Z');
const JUN = Date.parse('2026-06-01T00:00:00Z');

/** A table's history as the Spatial Catalog data source gives it: each row with the commits it came and went at. */
const history = () =>
  toDataFrame({
    refId: 'A',
    fields: [
      { name: 'name', type: FieldType.string, values: ['kept', 'deleted in May', 'added in March'] },
      { name: 'latitude', type: FieldType.number, values: [-2.9, -2.91, -2.92] },
      { name: 'longitude', type: FieldType.number, values: [-79, -79.01, -79.02] },
      { name: 'valid_from', type: FieldType.time, values: [JAN, JAN, MAR] },
      { name: 'valid_to', type: FieldType.time, values: [null, MAY, null] },
    ],
  });

describe('a map of rows that live from valid_from to valid_to', () => {
  const visState = (store: ReturnType<typeof createKeplerStore>) =>
    (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const loaded = async () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    loadDatasets(store, store.dispatch, framesToDatasets([history()]), { centerMap: false });
    await settle();
    return store;
  };
  /** The rows kepler's own filter keeps: names, in order. */
  const kept = (store: ReturnType<typeof createKeplerStore>) => {
    const vs = visState(store);
    const [filter] = vs.filters;
    const dataset = vs.datasets[filter.dataId[0]];
    const field = dataset.fields[filter.fieldIdx[0]];
    const keep = getFilterFunction(field, dataset.id, filter, [], dataset.dataContainer);
    const name = dataset.fields.findIndex((f: any) => f.name === 'name');
    const rows: string[] = [];
    for (let r = 0; r < dataset.dataContainer.numRows(); r++) {
      if (keep({ index: r })) {
        rows.push(dataset.dataContainer.valueAt(r, name));
      }
    }
    return rows;
  };

  it('keeps the rows alive at its time filter moment, by valid_to as the filter end field', async () => {
    const store = await loaded();
    const filters = visState(store).filters;
    // valid_from, the query's first time column, reaches kepler as `time`; one filter, valid_to its end.
    expect(filters.map((f: any) => [f.name[0], f.endName?.[0], f.type])).toEqual([['time', 'valid_to', 'timeRange']]);
    // A moment, the last (kepler's domain runs a second past the last end): the table as it is now, a row still
    // alive having no end.
    expect(filters[0].value).toEqual([MAY + 1000, MAY + 1000]);
    expect(kept(store)).toEqual(['kept', 'added in March']);
    expect(readFilters(store).map((f: any) => f.name[0])).toEqual(['time']);

    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, setFilter(0, 'value', [JAN + 1, JAN + 1])) as never);
    expect(kept(store)).toEqual(['kept', 'deleted in May']);
  });

  it('takes the dashboard range as its end: the table at the dashboard time', async () => {
    const store = await loaded();
    pushTimeRange(store, store.dispatch, { from: JAN, to: APR });
    expect(visState(store).filters[0].value).toEqual([APR, APR]);
    expect(kept(store)).toEqual(['kept', 'deleted in May', 'added in March']);
    pushTimeRange(store, store.dispatch, { from: JAN, to: JUN });
    expect(kept(store)).toEqual(['kept', 'added in March']);
  });

  it('keeps the rows in force by the pair its query names, at now when now is in their time', async () => {
    // Zones in force from Startdatum to Einddatum, a query with a Valid until: no clock, the pair said apart.
    const day = 24 * 3600 * 1000;
    const now = Date.now();
    const zones = toDataFrame({
      refId: 'Z',
      meta: { custom: { timeField: null, timeInterval: { start: 'Startdatum', end: 'Einddatum' } } },
      fields: [
        { name: 'zone', type: FieldType.string, values: ['ended', 'in force', 'to come'] },
        { name: 'latitude', type: FieldType.number, values: [51.5, 51.6, 51.7] },
        { name: 'longitude', type: FieldType.number, values: [5, 5.1, 5.2] },
        { name: 'Startdatum', type: FieldType.time, values: [now - 900 * day, now - 300 * day, now + 200 * day] },
        { name: 'Einddatum', type: FieldType.time, values: [now - 400 * day, null, now + 900 * day] },
      ],
    });
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    loadDatasets(store, store.dispatch, framesToDatasets([zones]), { centerMap: false });
    await settle();
    const [filter] = visState(store).filters;
    expect([filter.name[0], filter.endName?.[0]]).toEqual(['Startdatum', 'Einddatum']);
    // Now, not the last moment named (the zone to come ends years ahead).
    expect(filter.value[0]).toBe(filter.value[1]);
    expect(Math.abs(filter.value[0] - now)).toBeLessThan(60_000);
    const vs = visState(store);
    const dataset = vs.datasets[filter.dataId[0]];
    const keep = getFilterFunction(dataset.fields[filter.fieldIdx[0]], dataset.id, filter, [], dataset.dataContainer);
    const zone = dataset.fields.findIndex((f: any) => f.name === 'zone');
    const kept = [0, 1, 2].filter((r) => keep({ index: r })).map((r) => dataset.dataContainer.valueAt(r, zone));
    expect(kept).toEqual(['in force']);
  });

  it('sets a filter up once: one the user removed is not made again', async () => {
    const store = await loaded();
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, removeFilter(0)) as never);
    await settle();
    expect(visState(store).filters).toEqual([]);
  });
});
