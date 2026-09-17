import { Layer } from '@kepler.gl/layers';
import { processRowObject } from '@kepler.gl/processors';
import KeplerTable from '@kepler.gl/table';

import { pictureKey } from './pictureKeys';
import { MAX_PICTURES } from './pictureRows';
import { readPictureAssignment, resetPictureStateForTests } from './pictureState';
import { makeSymbolLayer } from './symbolLayer';

/**
 * The symbol layer drawing pictures, on kepler's real base `Layer` over a real
 * `KeplerTable` — the lesson of `symbolLayer.kepler.test.ts`: a stand-in base
 * class hid every serious defect the first version had.
 */

const built: Array<Record<string, any>> = [];
const SymbolLayer = makeSymbolLayer(Layer as never, (props) => {
  built.push(props);
  return { props };
}) as unknown as new (props: Record<string, unknown>) => any;

const PIN = 'https://example.org/pin.png';

const places = [
  { latitude: -2.9, longitude: -79.0, picture: 'https://example.org/cuenca.png', name: 'Cuenca' },
  { latitude: -0.19, longitude: -78.48, picture: '', name: 'Quito' },
  { latitude: -2.17, longitude: -79.92, picture: 'javascript:alert(1)', name: 'Guayaquil' },
];

function placesTable(): InstanceType<typeof KeplerTable> {
  const table = new KeplerTable({ info: { id: 'places', label: 'Places' }, color: [0, 92, 255] });
  table.updateSchema(processRowObject(places) as never);
  return table;
}

function pictureLayer(table: InstanceType<typeof KeplerTable>, visConfig: Record<string, unknown> = {}, bindPicture = true) {
  const column = (name: string) => ({ value: name, fieldIdx: table.getColumnFieldIdx(name) });
  const layer = new SymbolLayer({
    id: 'places',
    dataId: table.id,
    columns: {
      lat: column('latitude'),
      lng: column('longitude'),
      ...(bindPicture ? { picture: column('picture') } : {}),
    },
  });
  layer.updateLayerConfig({
    visConfig: { ...layer.config.visConfig, symbolSource: 'picture', pictureUrl: PIN, ...visConfig },
  });
  return layer;
}

/** What kepler's `renderDeckGlLayer` hands a layer, minus what no test here reads. */
function render(layer: any, table: InstanceType<typeof KeplerTable>, data = layer.formatLayerData({ [table.id]: table })) {
  built.length = 0;
  layer.renderLayer({ data, gpuFilter: table.gpuFilter, mapState: { zoom: 6, latitude: -2, longitude: -79 }, idx: 0, visible: true });
  return { symbols: built.find((props) => String(props.id).endsWith('-symbol'))!, built: [...built] };
}

beforeEach(() => {
  resetPictureStateForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the symbol layer drawing pictures, on kepler’s real Layer', () => {
  it('registers the picture knobs with defaults that leave a saved shape layer as it was', () => {
    const layer = new SymbolLayer({ id: 'x' });

    expect(layer.config.visConfig).toMatchObject({ symbolSource: 'shape', pictureUrl: '', pictureAnchor: 'center' });
    expect(layer.optionalColumns).toEqual(['altitude', 'picture']);
  });

  it('hands deck a picture per row: its own, or the layer’s when it has none', () => {
    const table = placesTable();
    const { symbols } = render(pictureLayer(table, { pictureAnchor: 'bottom' }), table);

    expect(symbols.picture).toBe(true);
    expect(symbols.keplerLayerId).toBeUndefined();
    expect(symbols.id).toBe('places-picture-symbol');
    expect(symbols.symbols).toBeUndefined();
    expect(symbols.data.map((row: { index: number }) => row.index)).toEqual([0, 1]);
    expect(symbols.getIcon(symbols.data[0])).toMatchObject({
      id: pictureKey('https://example.org/cuenca.png', 'bottom'),
      anchorY: 128,
      mask: false,
    });
    expect(symbols.getIcon(symbols.data[1]).id).toBe(pictureKey(PIN, 'bottom'));
  });

  it('records the row whose URL cannot load against the layer object', () => {
    const table = placesTable();
    const layer = pictureLayer(table);
    render(layer, table);

    expect(readPictureAssignment(layer)!.failures).toEqual([{ url: 'javascript:alert(1)', problem: 'scheme' }]);
  });

  it('keeps apart the pictures of two layers with the same id, as a repeated panel has', () => {
    const table = placesTable();
    const panelA = pictureLayer(table, {}, false);
    const panelB = pictureLayer(table, { pictureUrl: 'https://example.org/other.png' }, false);
    render(panelA, table);
    render(panelB, table);

    expect(panelA.id).toBe(panelB.id);
    expect(readPictureAssignment(panelA)!.urls).toEqual([PIN]);
    expect(readPictureAssignment(panelB)!.urls).toEqual(['https://example.org/other.png']);
  });

  it('draws every row with the layer picture when no column is bound', () => {
    const table = placesTable();
    const { symbols } = render(pictureLayer(table, {}, false), table);

    expect(symbols.data).toHaveLength(3);
    expect(new Set(symbols.data.map((row: unknown) => symbols.getIcon(row).id))).toEqual(new Set([pictureKey(PIN, 'center')]));
  });

  it('builds no outline, shadow or gradient, and leaves the pictures’ colours alone', () => {
    const table = placesTable();
    const { built: layers, symbols } = render(pictureLayer(table, { outline: true, shadow: true, gradient: true }), table);

    expect(layers.map((props) => props.id)).toEqual(['places-picture-symbol']);
    expect(symbols.gradient).toBeUndefined();
    expect(symbols.getColor).toEqual([255, 255, 255, 255]);
  });

  it('stands upright and turns by the angle as shapes do', () => {
    const table = placesTable();
    const { symbols } = render(pictureLayer(table, { upright: true, angleDegrees: 30 }), table);

    expect(symbols.billboard).toBe(true);
    expect(symbols.getAngle(symbols.data[0])).toBe(-30);
  });

  it('hands deck the same rows while nothing that decides them changed', () => {
    const table = placesTable();
    const layer = pictureLayer(table);
    const data = layer.formatLayerData({ [table.id]: table });

    const first = render(layer, table, data).symbols;
    const second = render(layer, table, data).symbols;

    expect(second.data).toBe(first.data);
  });

  it('hands deck the same rows when kepler formats the layer again for a filter change', () => {
    const table = placesTable();
    const layer = pictureLayer(table);
    const first = layer.formatLayerData({ [table.id]: table });
    const drawnFirst = render(layer, table, first).symbols.data;

    // What kepler does on every frame of the dashboard clock: format again,
    // handing back the last result as the old data.
    const second = layer.formatLayerData({ [table.id]: table }, first);

    expect(second.data).toBe(first.data);
    expect(render(layer, table, second).symbols.data).toBe(drawnFirst);
  });

  it('keeps one deck layer id however many pictures it has drawn: the texture starts afresh inside deck', () => {
    const table = placesTable();
    const layer = pictureLayer(table, {}, false);
    const data = layer.formatLayerData({ [table.id]: table });
    const ids: string[] = [];
    const triggers: unknown[] = [];

    for (let i = 0; i <= MAX_PICTURES; i++) {
      layer.updateLayerConfig({ visConfig: { ...layer.config.visConfig, pictureUrl: `https://example.org/${i}.png` } });
      const { symbols } = render(layer, table, data);
      ids.push(symbols.id);
      triggers.push(symbols.updateTriggers.getIcon);
    }

    expect(new Set(ids)).toEqual(new Set(['places-picture-symbol']));
    // The picture, its anchor and its column: nothing that counts generations.
    expect(triggers[MAX_PICTURES]).toEqual([`https://example.org/${MAX_PICTURES}.png`, 'center', -1]);
  });

  it('keeps a colour bound while drawing shapes out of the legend while drawing pictures', () => {
    const condition = new SymbolLayer({ id: 'x' }).visualChannels.color.condition;

    expect(condition({ visConfig: { symbolSource: 'picture' } })).toBe(false);
    expect(condition({ visConfig: { symbolSource: 'shape' } })).toBe(true);
  });

  it('draws shapes exactly as before when the source is shape', () => {
    const table = placesTable();
    const { symbols } = render(pictureLayer(table, { symbolSource: 'shape', symbol: 'circle' }), table);

    expect(symbols.id).toBe('places-symbol');
    expect(symbols.symbols).toEqual(['circle']);
    expect(symbols.picture).toBeUndefined();
    expect(symbols.data).toHaveLength(3);
  });
});
