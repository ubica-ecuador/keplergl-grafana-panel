import { DataFrame, FieldType, toDataFrame } from '@grafana/data';
import { registerEntry } from '@kepler.gl/actions';
import { readFileSync } from 'fs';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { addAutoLayer, loadDatasets, pushTimeRange } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

/**
 * The dashboard clock over scattered stations, through kepler's own store.
 *
 * The provisioned e2e fixture — eight stations reporting at two hours, with the
 * dashboard window over the first — loaded the way the panel loads it: rows
 * into `addDataToMap`, the symbol layer through `addAutoLayer`, the dashboard
 * range through `pushTimeRange`. Then the layer is asked what it would hand
 * deck, and the GPU filter is applied to it the way deck's filter extension
 * does: a row is drawn when every filter value lies within `filterRange`.
 *
 * The browser check in `tests/symbols.spec.ts` reads the same thing; this one
 * runs where CI does. Only the atlas painting is replaced, because jsdom has no
 * 2D canvas to paint into.
 */

jest.mock('./symbolGlyphs', () => ({
  ...jest.requireActual('./symbolGlyphs'),
  paintGlyphs: (glyphs: Array<{ key: string }>) =>
    Object.fromEntries(glyphs.map((glyph) => [glyph.key, { x: 0, y: 0, width: 96, height: 96 }])),
}));

jest.mock('./vectorFieldGlyphs', () => ({
  ...jest.requireActual('./vectorFieldGlyphs'),
  createAtlasCanvas: () => ({ canvas: {}, ctx: {} }),
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

describe('symbol layer under the dashboard clock', () => {
  it('draws one symbol per station, not one per station per hour', async () => {
    const dashboard = JSON.parse(readFileSync('provisioning/dashboards/symbols.json', 'utf8'));
    const panel = dashboard.panels.find((candidate: { id: number }) => candidate.id === 2);
    expect(panel.options.timeSync).toBe('toMap');

    const [dataset] = framesToDatasets([rawFrame(panel.targets[0].rawFrameContent)]);
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    loadDatasets(store.dispatch, [dataset]);
    await settle();
    addAutoLayer(store, store.dispatch, dataset.symbolLayer!, dataset.id);
    expect(
      pushTimeRange(store, store.dispatch, { from: Date.parse(dashboard.time.from), to: Date.parse(dashboard.time.to) })
    ).toBe(true);
    await settle();

    const visState = (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState;
    const index = visState.layers.findIndex((layer: { type?: string }) => layer.type === 'symbol');
    const layer = visState.layers[index];
    const [deckLayer] = layer.renderLayer({
      data: visState.layerData[index],
      gpuFilter: visState.datasets[layer.config.dataId].gpuFilter,
      mapState: {},
    });
    const { data, getFilterValue, filterRange } = deckLayer.props;
    const drawn = data.filter((row: unknown) =>
      (getFilterValue(row) as number[]).every((value, i) => value >= filterRange[i][0] && value <= filterRange[i][1])
    );

    expect(visState.filters.map((filter: { type: string; gpu: boolean }) => [filter.type, filter.gpu])).toEqual([
      ['timeRange', true],
    ]);
    // Every row reaches deck — the filter runs on the GPU, not on the rows...
    expect(data).toHaveLength(16);
    // ...and the window over the first hour leaves each station once.
    expect(drawn).toHaveLength(8);
    expect(new Set(drawn.map((row: { index: number }) => row.index))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });
});
