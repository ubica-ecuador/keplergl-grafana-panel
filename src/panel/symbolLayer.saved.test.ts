import { DataFrame, FieldType, toDataFrame } from '@grafana/data';
import { registerEntry } from '@kepler.gl/actions';
import { validateLayerWithData } from '@kepler.gl/reducers';
import KeplerGlSchema from '@kepler.gl/schemas';
import { readFileSync } from 'fs';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { loadDatasets } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { pictureKey } from './pictureKeys';
import {
  readPictureAssignment,
  readPictureOutcomes,
  resetPictureStateForTests,
  summarisePictures,
} from './pictureState';

/**
 * The provisioned styled and standing panels, restored the way kepler restores
 * a saved layer: the saved config parsed by kepler's schema, then bound to the
 * query's dataset by kepler's own merger.
 *
 * `addDataToMap` with a config hangs under jest, so the merge is called
 * directly rather than through the store; the dataset still comes from the
 * store, built from the panel's own query. What would silently go missing is
 * exactly what this pins: a style knob the schema drops, a channel or a label
 * whose column does not bind.
 */

jest.mock('./symbolGlyphs', () => ({
  ...jest.requireActual('./symbolGlyphs'),
  paintGlyphs: (glyphs: Array<{ key: string; anchor: [number, number] }>) =>
    Object.fromEntries(
      glyphs.map((glyph) => [
        glyph.key,
        { x: 0, y: 0, width: 96, height: 96, anchorX: glyph.anchor[0], anchorY: glyph.anchor[1], mask: true },
      ])
    ),
}));

jest.mock('./vectorFieldGlyphs', () => ({
  ...jest.requireActual('./vectorFieldGlyphs'),
  createAtlasCanvas: () => ({ canvas: {}, ctx: { drawImage: () => undefined } }),
}));

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

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

async function restore(panelId: number) {
  const dashboard = JSON.parse(readFileSync('provisioning/dashboards/symbols.json', 'utf8'));
  const panel = dashboard.panels.find((candidate: { id: number }) => candidate.id === panelId);

  const [dataset] = framesToDatasets([rawFrame(panel.targets[0].rawFrameContent)]);
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  loadDatasets(store.dispatch, [dataset]);
  await settle();

  const visState = (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState;
  const parsed = KeplerGlSchema.parseSavedConfig(panel.options.mapConfig) as any;
  const [savedLayer] = parsed.visState.layers;
  const table = visState.datasets[savedLayer.config.dataId];
  const layer = validateLayerWithData(table, savedLayer, visState.layerClasses) as any;
  // What kepler's merge does next for every merged layer: channel domains from
  // the data. Without them a bound channel has no scale.
  layer.updateLayerDomain({ [table.id]: table });

  const data = layer.formatLayerData({ [table.id]: table });
  const deckLayers = layer.renderLayer({ data, gpuFilter: table.gpuFilter, mapState: {} }) as Array<{
    id: string;
    props: any;
  }>;
  return { layer, deckLayers };
}

describe('the provisioned symbol panels, restored from their saved config', () => {
  it('keeps the styled panel’s outline, shadow, gradient, channels and labels', async () => {
    const { layer, deckLayers } = await restore(3);

    expect(layer.type).toBe('symbol');
    expect(layer.config.visConfig).toMatchObject({
      outline: true,
      outlineColor: [255, 255, 255],
      shadow: true,
      gradient: true,
      gradientTail: 0.75,
      directionConvention: 'from',
    });
    expect(layer.config.angleField?.name).toBe('wind_direction');
    expect(layer.config.sizeField?.name).toBe('wind_speed');
    expect(layer.config.colorField?.name).toBe('wind_speed');
    expect(layer.config.textLabel[0].field?.name).toBe('name');

    expect(deckLayers.map((deckLayer) => deckLayer.id)).toEqual([
      'styled-stations-symbol-shadow',
      'styled-stations-symbol-outline',
      'styled-stations-symbol',
      'styled-stations-label-name',
    ]);
    const symbols = deckLayers[2].props;
    expect(symbols.gradientTail).toBe(0.75);
    expect(symbols.data).toHaveLength(8);
  });

  it('keeps the standing panel upright, unturned and labelled', async () => {
    const { layer, deckLayers } = await restore(4);

    expect(layer.config.visConfig).toMatchObject({ upright: true, symbol: 'marker' });
    expect(layer.config.angleField).toBeFalsy();
    expect(layer.config.textLabel[0].field?.name).toBe('name');

    const symbols = deckLayers.find((deckLayer) => deckLayer.id === 'standing-stations-symbol')!.props;
    expect(symbols.billboard).toBe(true);
    expect(symbols.getIcon(symbols.data[0])).toBe('marker');
    expect(symbols.getAngle(symbols.data[0])).toBe(0);
  });

  it('keeps the pictures panel drawing a picture per station, the layer’s where a station has none', async () => {
    resetPictureStateForTests();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { layer, deckLayers } = await restore(5);

      expect(layer.config.visConfig).toMatchObject({ symbolSource: 'picture', pictureAnchor: 'bottom', upright: true });
      expect(String(layer.config.visConfig.pictureUrl)).toMatch(/^data:image\/png;base64,/);
      expect(layer.config.columns.picture.value).toBe('picture');

      expect(deckLayers.map((deckLayer) => deckLayer.id)).toEqual(['picture-stations-picture-symbol']);
      const symbols = deckLayers[0].props;
      expect(symbols.data).toHaveLength(4);
      const idOf = (index: number) => symbols.getIcon(symbols.data.find((row: { index: number }) => row.index === index)).id;
      expect(idOf(0)).toBe(pictureKey('/public/plugins/ubica-keplergl-panel/img/logo-small.svg', 'bottom'));
      expect(idOf(2)).toBe(pictureKey(layer.config.visConfig.pictureUrl, 'bottom'));
      expect(symbols.loadOptions.core.fetch).toEqual(expect.any(Function));
      expect(summarisePictures(readPictureAssignment(layer), readPictureOutcomes()).total).toBe(4);
    } finally {
      warn.mockRestore();
    }
  });
});
