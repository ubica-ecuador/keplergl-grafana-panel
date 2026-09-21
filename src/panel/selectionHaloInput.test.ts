import { DataFrame, FieldType, toDataFrame } from '@grafana/data';
import { registerEntry, toggleSplitMap, wrapTo } from '@kepler.gl/actions';
import { readFileSync } from 'fs';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { applyFieldFilter, applyRangeFilter, loadDatasets, pushTimeRange } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { selectionHalo } from './selectionHalo';
import { haloInputFrom } from './selectionHaloInput';

/**
 * kepler's state read into the halo's input, through the store the panel really
 * builds. The point of running kepler's reducers rather than hand-written
 * objects: the filters are evaluated by kepler's own `getFilterFunction`, and
 * only a real range or time filter — GPU filters, which `filteredIndex` never
 * reflects — can show that works.
 */

jest.mock('./symbolGlyphs', () => ({
  ...jest.requireActual('./symbolGlyphs'),
  paintGlyphs: (glyphs: Array<{ key: string }>) =>
    Object.fromEntries(glyphs.map((glyph) => [glyph.key, { x: 0, y: 0, width: 96, height: 96 }])),
}));

/** kepler's data pipeline settles on the task middleware's promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A testdata `raw_frame` as Grafana hands it to the panel. */
function rawFrame(content: string): DataFrame {
  const [raw] = JSON.parse(content);
  const types: Record<string, FieldType> = { time: FieldType.time, number: FieldType.number };
  return toDataFrame({
    refId: 'A',
    fields: raw.schema.fields.map((field: { name: string; type: string }, i: number) => ({
      name: field.name,
      type: types[field.type] ?? FieldType.string,
      values: raw.data.values[i],
    })),
  });
}

/** The cross-filter fixture: 15 sites, `value` = 10 + 3·(n − 1), so site-07 is 28. */
async function crossFilterStore() {
  const dashboard = JSON.parse(readFileSync('provisioning/dashboards/varsync.json', 'utf8'));
  const [dataset] = framesToDatasets([rawFrame(dashboard.panels[0].targets[0].rawFrameContent)]);
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  loadDatasets(store.dispatch, [dataset]);
  await settle();
  return store;
}

const visStateOf = (store: { getState: () => unknown }) =>
  (store.getState() as { keplerGl: Record<string, { visState: never }> }).keplerGl[KEPLER_INSTANCE_ID].visState;

describe('haloInputFrom', () => {
  it('reads the point layer and its dataset so the selected site is ringed', async () => {
    const store = await crossFilterStore();
    const input = haloInputFrom({ visState: visStateOf(store), zoom: 13, index: 0, selection: { site: ['site-02'] } });

    expect(input.layers).toEqual([
      expect.objectContaining({ type: 'point', isVisible: true, radius: { base: 10, fixed: false } }),
    ]);
    expect(input.sideLayers).toBeNull();
    expect(selectionHalo(input).rings).toEqual([{ position: [-79.02, -2.895], radiusPx: 10 }]);
  });

  it('lets a row through a range filter — a GPU filter — only inside its window', async () => {
    const store = await crossFilterStore();
    applyRangeFilter(store, store.dispatch, 'value', [20, 40]);
    await settle();
    const visState = visStateOf(store) as unknown as { filters: Array<{ gpu: boolean }> };
    expect(visState.filters.map((filter) => filter.gpu)).toEqual([true]);

    const input = haloInputFrom({ visState: visState as never, zoom: 13, index: 0, selection: {} });
    const dataId = input.layers[0].dataId;

    expect(input.rowPasses(dataId, 1)).toBe(false); // site-02, value 13
    expect(input.rowPasses(dataId, 6)).toBe(true); // site-07, value 28
  });

  it('ignores a filter with nothing selected, as kepler does', async () => {
    const store = await crossFilterStore();
    applyFieldFilter(store, store.dispatch, 'category', []);
    await settle();

    const input = haloInputFrom({ visState: visStateOf(store), zoom: 13, index: 0, selection: {} });
    expect(input.rowPasses(input.layers[0].dataId, 0)).toBe(true);
  });

  it('lets a row through the dashboard clock only in the hour it shows', async () => {
    const dashboard = JSON.parse(readFileSync('provisioning/dashboards/symbols.json', 'utf8'));
    const panel = dashboard.panels.find((candidate: { id: number }) => candidate.id === 2);
    const [dataset] = framesToDatasets([rawFrame(panel.targets[0].rawFrameContent)]);
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    loadDatasets(store.dispatch, [dataset]);
    await settle();
    pushTimeRange(store, store.dispatch, { from: Date.parse(dashboard.time.from), to: Date.parse(dashboard.time.to) });
    await settle();

    const input = haloInputFrom({ visState: visStateOf(store), zoom: 13, index: 0, selection: {} });
    // Sixteen rows, eight stations at two hours; the window covers the first.
    const passing = [...Array(16).keys()].filter((row) => input.rowPasses(dataset.id, row));
    expect(passing).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('reads the layers of this side when the map is split', async () => {
    const store = await crossFilterStore();
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, toggleSplitMap(0)) as never);
    await settle();

    // kepler's own computeSplitMapLayers puts the pre-existing layers on the
    // side that was already there (index 0) and leaves the new side (index 1)
    // empty — the opposite of index 1 inheriting them.
    const visState = visStateOf(store);
    const left = haloInputFrom({ visState, zoom: 13, index: 0, selection: {} });
    const right = haloInputFrom({ visState, zoom: 13, index: 1, selection: {} });
    expect(left.sideLayers).toEqual({ [left.layers[0].id]: true });
    expect(right.sideLayers).toEqual({});
  });
});
