import { Layer } from '@kepler.gl/layers';
import { processRowObject } from '@kepler.gl/processors';
import KeplerTable from '@kepler.gl/table';
import { applyFilterFieldName, getDefaultFilter } from '@kepler.gl/utils';

import { deckAngle, makeSymbolLayer } from './symbolLayer';

/**
 * The symbol layer on kepler's real base `Layer`, over a real `KeplerTable`.
 *
 * `symbolLayer.test.ts` runs the layer on a hand-written stand-in, and that
 * stand-in is kinder than kepler in every way that matters: its accessors are
 * always functions, it has no GPU filter, and it never throws. Every defect this
 * file pins survived there and appeared the moment the layer met the real class
 * — a constant where a function was assumed, a clock that filtered nothing, a
 * missing size that became a colour. So these tests build the dataset the way
 * kepler does, bind channels through kepler's own `updateLayerVisualChannel`,
 * and read what would reach deck.
 */

const built: Array<Record<string, any>> = [];
const SymbolLayer = makeSymbolLayer(Layer as never, (props) => {
  built.push(props);
  return { props };
}) as unknown as new (props: Record<string, unknown>) => any;

/** Two timesteps a minute apart, as the dashboard clock would see them. */
const T0 = Date.UTC(2026, 8, 15, 12, 0);
const T1 = T0 + 60_000;

/**
 * Three stations, each reporting at both timesteps. The third never reports a
 * speed, and the second's later speed is `NaN` — which, unlike a null, reaches
 * kepler's data container as it is.
 *
 * Epoch milliseconds, because that is what `toKeplerRows` hands kepler for a
 * Grafana time column — and what kepler's analyser recognises as a timestamp.
 */
const rows = [
  { time: T0, latitude: -2.9, longitude: -79.0, heading: 90, speed: 4, name: 'Cuenca' },
  { time: T0, latitude: -0.19, longitude: -78.48, heading: 180, speed: 9, name: 'Quito' },
  { time: T0, latitude: -2.17, longitude: -79.92, heading: 270, speed: null, name: 'Guayaquil' },
  { time: T1, latitude: -2.9, longitude: -79.0, heading: 95, speed: 5, name: 'Cuenca' },
  { time: T1, latitude: -0.19, longitude: -78.48, heading: 185, speed: NaN, name: 'Quito' },
  { time: T1, latitude: -2.17, longitude: -79.92, heading: 275, speed: null, name: 'Guayaquil' },
];

function stationsTable(): InstanceType<typeof KeplerTable> {
  const table = new KeplerTable({ info: { id: 'stations', label: 'Stations' }, color: [0, 92, 255] });
  table.updateSchema(processRowObject(rows) as never);
  return table;
}

function fieldOf(table: InstanceType<typeof KeplerTable>, name: string): any {
  return table.fields.find((field) => field.name === name);
}

/** A symbol layer on the table, with the channels named bound the way kepler's merger binds them. */
function symbolLayer(table: InstanceType<typeof KeplerTable>, channels: { angle?: string; size?: string } = {}) {
  const column = (name: string) => ({ value: name, fieldIdx: table.getColumnFieldIdx(name) });
  const layer = new SymbolLayer({
    id: 'symbols',
    dataId: table.id,
    columns: { lat: column('latitude'), lng: column('longitude') },
  });

  if (channels.angle) {
    layer.updateLayerConfig({ angleField: fieldOf(table, channels.angle), angleScale: 'linear' });
    layer.updateLayerVisualChannel(table, 'angle');
  }
  if (channels.size) {
    layer.updateLayerConfig({ sizeField: fieldOf(table, channels.size), sizeScale: 'sqrt' });
    layer.updateLayerVisualChannel(table, 'size');
  }
  return layer;
}

/** What kepler's `renderDeckGlLayer` hands a layer, minus the parts no test here reads. */
function render(layer: any, table: InstanceType<typeof KeplerTable>) {
  const data = layer.formatLayerData({ [table.id]: table });
  built.length = 0;
  layer.renderLayer({
    data,
    gpuFilter: table.gpuFilter,
    mapState: { zoom: 6, latitude: -2, longitude: -79 },
    idx: 0,
    visible: true,
  });
  return built[0];
}

beforeEach(() => {
  built.length = 0;
});

describe('symbol layer on kepler’s real Layer', () => {
  it('turns every symbol to the fixed angle when no rotation column is bound', () => {
    // kepler hands over the channel's *constant* here, not a function: calling
    // it per row was a TypeError deck swallowed, and the layer drew nothing.
    const table = stationsTable();
    const layer = symbolLayer(table);
    layer.updateLayerVisConfig({ angleDegrees: 45 });

    const props = render(layer, table);

    expect(props.data.length).toBeGreaterThan(0);
    for (const row of props.data) {
      expect(props.getAngle(row)).toBe(deckAngle(45, 'towards'));
      // Size and colour arrive as constants too; the layer hands deck functions.
      expect(props.getSize(row)).toBe(layer.config.visConfig.symbolSize);
      expect(props.getColor(row)).toEqual(layer.config.color);
    }
  });

  it('does not make kepler warn that it has no accessor for the angle', () => {
    // An angle of 0 is falsy, and kepler logs "Failed to provide accessor
    // function" for any falsy channel value — on every data update.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const table = stationsTable();
      render(symbolLayer(table), table);

      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.filter((message) => message.includes('Failed to provide accessor'))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('reads a bound rotation column straight through, in degrees', () => {
    const table = stationsTable();
    const layer = symbolLayer(table, { angle: 'heading' });

    const props = render(layer, table);
    const first = props.data.find((row: { index: number }) => row.index === 0);

    expect(props.getAngle(first)).toBe(deckAngle(90, 'towards'));
  });

  it('thins symbols without throwing when declutter is on and no size column is bound', () => {
    // The size channel's constant reached `thinBySpacing` as if it were a
    // function, and the throw escaped kepler into Grafana's error boundary.
    const table = stationsTable();
    const layer = symbolLayer(table);
    layer.updateLayerVisConfig({
      declutter: true,
      declutterSpacingPx: 40,
      flowContext: { camera: { zoom: 6, latitude: -2 } },
    });

    expect(() => render(layer, table)).not.toThrow();
    expect(built).toHaveLength(1);
    for (const row of built[0].data) {
      expect(built[0].getSize(row)).toBe(layer.config.visConfig.symbolSize);
    }
  });

  it('draws a symbol whose size is missing at the fixed size, rather than not at all', () => {
    // Without a null value of its own the channel fell back to kepler's
    // no-value *colour*, [0, 0, 0, 0], which deck read as a size of nothing.
    const table = stationsTable();
    const layer = symbolLayer(table, { size: 'speed' });
    layer.updateLayerVisConfig({ symbolSize: 22 });

    const props = render(layer, table);
    const row = (index: number) => props.data.find((candidate: { index: number }) => candidate.index === index);

    // Guayaquil's null, and Quito's later NaN.
    expect(props.getSize(row(2))).toBe(22);
    expect(props.getSize(row(4))).toBe(22);
    // A real speed still goes through the channel's scale.
    expect(props.getSize(row(0))).toBeGreaterThanOrEqual(12);
    expect(props.getSize(row(1))).toBeGreaterThan(props.getSize(row(0)));
  });

  it('hands deck a filter value per row, so the dashboard clock separates timesteps', () => {
    const table = stationsTable();
    const layer = symbolLayer(table);

    // A time filter the way kepler builds one, windowed on the first timestep.
    const { filter } = applyFilterFieldName(
      getDefaultFilter({ dataId: table.id, id: 'clock' }) as never,
      { [table.id]: table } as never,
      table.id,
      'time'
    );
    const clock = { ...(filter as any), gpuChannel: [0], value: [T0, T0 + 30_000] };
    table.filterTable([clock] as never, [layer], {});

    const props = render(layer, table);
    const [low, high] = props.filterRange[0];
    const shown = props.data.filter((row: unknown) => {
      const value = props.getFilterValue(row)[0];
      return value >= low && value <= high;
    });

    expect(clock.gpu).toBe(true);
    // Three stations, not six: the second timestep is outside the window.
    expect(shown.map((row: { index: number }) => row.index).sort()).toEqual([0, 1, 2]);
    expect(props.updateTriggers.getFilterValue).toBe(table.gpuFilter.filterValueUpdateTriggers);
  });

  it('thins among the rows the clock shows, so a station hidden later does not hide its shown hour', () => {
    // Cuenca is 4 at the first timestep and 5 at the second, at the same place.
    // Thinning every row kept the heavier second one, which the clock's window
    // over the first then hid on the GPU: the station vanished altogether.
    const table = stationsTable();
    const layer = symbolLayer(table, { size: 'speed' });
    layer.updateLayerVisConfig({
      declutter: true,
      declutterSpacingPx: 10,
      flowContext: { camera: { zoom: 6, latitude: -2 } },
    });

    const { filter } = applyFilterFieldName(
      getDefaultFilter({ dataId: table.id, id: 'clock' }) as never,
      { [table.id]: table } as never,
      table.id,
      'time'
    );
    table.filterTable([{ ...(filter as any), gpuChannel: [0], value: [T0, T0 + 30_000] }] as never, [layer], {});

    const props = render(layer, table);
    const [low, high] = props.filterRange[0];
    const shown = props.data.filter((row: unknown) => {
      const value = props.getFilterValue(row)[0];
      return value >= low && value <= high;
    });

    expect(shown.map((row: { index: number }) => row.index).sort()).toEqual([0, 1, 2]);
  });

  it('gives deck an update trigger for every channel, so changing a column redraws', () => {
    const table = stationsTable();
    const layer = symbolLayer(table, { angle: 'heading' });

    const before = render(layer, table).updateTriggers;
    layer.updateLayerConfig({ sizeField: fieldOf(table, 'speed'), sizeScale: 'sqrt' });
    layer.updateLayerVisualChannel(table, 'size');
    const after = render(layer, table).updateTriggers;

    expect(before.getSize).toBeDefined();
    expect(before.getColor).toBeDefined();
    expect(after.getSize).not.toEqual(before.getSize);
    // The angle keeps the layer's own reading on top of the channel's.
    expect(after.getAngle).toMatchObject({ angleField: expect.objectContaining({ name: 'heading' }) });
    expect(after.getIcon).toEqual(before.getIcon);
  });

  it('changes the angle trigger with the fixed angle, the rotation column and the convention', () => {
    const table = stationsTable();
    const layer = symbolLayer(table);

    const unbound = render(layer, table).updateTriggers.getAngle;
    layer.updateLayerVisConfig({ angleDegrees: 30 });
    const fixed = render(layer, table).updateTriggers.getAngle;
    layer.updateLayerConfig({ angleField: fieldOf(table, 'heading'), angleScale: 'linear' });
    layer.updateLayerVisualChannel(table, 'angle');
    const bound = render(layer, table).updateTriggers.getAngle;
    layer.updateLayerVisConfig({ directionConvention: 'from' });
    const turned = render(layer, table).updateTriggers.getAngle;

    expect(fixed).not.toEqual(unbound);
    expect(bound).not.toEqual(fixed);
    expect(turned).not.toEqual(bound);
  });

  it('draws no shadow unless asked to', () => {
    const table = stationsTable();
    render(symbolLayer(table), table);

    expect(built).toHaveLength(1);
    expect(built[0].shadow).toBeUndefined();
  });

  it('draws a shadow beneath the symbols: the same rows, dark, offset the same way whatever their angle', () => {
    const table = stationsTable();
    const layer = symbolLayer(table, { angle: 'heading', size: 'speed' });
    layer.updateLayerVisConfig({ shadow: true, shadowOpacity: 0.5, shadowDistance: 6 });

    render(layer, table);
    const [shadow, symbols] = built;

    // First in the list, so deck draws it underneath.
    expect(built).toHaveLength(2);
    expect(shadow.shadow).toBe(true);
    expect(symbols.shadow).toBeUndefined();
    expect(shadow.id).not.toBe(symbols.id);

    expect(shadow.data).toBe(symbols.data);
    expect(shadow.symbols).toEqual(symbols.symbols);
    for (const row of shadow.data) {
      expect(shadow.getAngle(row)).toBe(symbols.getAngle(row));
      expect(shadow.getSize(row)).toBe(symbols.getSize(row));
      expect(shadow.getColor(row)).toEqual([0, 0, 0, 128]);
    }
    // A constant, and deck adds it after turning the icon, so every shadow
    // falls the same way on screen.
    expect(shadow.getPixelOffset).toEqual([6, 6]);

    // Hidden with its symbol by the clock, and never the thing a hover finds.
    expect(shadow.getFilterValue).toBe(symbols.getFilterValue);
    expect(shadow.filterRange).toBe(symbols.filterRange);
    expect(shadow.pickable).toBe(false);
    expect(shadow.onFilteredItemsChange).toBeUndefined();
  });

  it('redraws the shadow when its intensity or distance changes', () => {
    const table = stationsTable();
    const layer = symbolLayer(table);
    layer.updateLayerVisConfig({ shadow: true, shadowOpacity: 0.5, shadowDistance: 4 });

    render(layer, table);
    const before = built[0].updateTriggers;
    layer.updateLayerVisConfig({ shadowOpacity: 0.8, shadowDistance: 10 });
    render(layer, table);
    const after = built[0].updateTriggers;

    expect(after.getColor).not.toEqual(before.getColor);
    expect(after.getPixelOffset).not.toEqual(before.getPixelOffset);
  });

  it('draws an outline between the shadow and the symbols: the same rows, in the outline colour, not offset', () => {
    const table = stationsTable();
    const layer = symbolLayer(table, { angle: 'heading', size: 'speed' });
    layer.updateLayerVisConfig({
      shadow: true,
      outline: true,
      outlineColor: [20, 30, 40],
      outlineThickness: 4,
    });

    render(layer, table);
    const [shadow, outline, symbols] = built;

    expect(built).toHaveLength(3);
    expect(shadow.shadow).toBe(true);
    expect(outline.outline).toBe(4);
    expect(symbols.outline).toBeUndefined();
    expect(new Set(built.map((props) => props.id)).size).toBe(3);

    expect(outline.data).toBe(symbols.data);
    for (const row of outline.data) {
      expect(outline.getAngle(row)).toBe(symbols.getAngle(row));
      expect(outline.getSize(row)).toBe(symbols.getSize(row));
      expect(outline.getColor(row)).toEqual([20, 30, 40, 255]);
    }
    expect(outline.getPixelOffset).toBeUndefined();
    expect(outline.getFilterValue).toBe(symbols.getFilterValue);
    expect(outline.pickable).toBe(false);
    expect(outline.onFilteredItemsChange).toBeUndefined();
  });

  it('redraws the outline when its colour or thickness changes', () => {
    const table = stationsTable();
    const layer = symbolLayer(table);
    layer.updateLayerVisConfig({ outline: true, outlineColor: [255, 255, 255], outlineThickness: 2 });

    render(layer, table);
    const before = built[0].updateTriggers;
    layer.updateLayerVisConfig({ outlineColor: [0, 0, 0], outlineThickness: 6 });
    render(layer, table);
    const after = built[0].updateTriggers;

    expect(after.getColor).not.toEqual(before.getColor);
    expect(after.getIcon).not.toEqual(before.getIcon);
  });

  describe('text labels', () => {
    /** What `renderLayer` returns, which is where kepler's own text layers land. */
    function renderAll(layer: any, table: InstanceType<typeof KeplerTable>) {
      built.length = 0;
      return layer.renderLayer({
        data: layer.formatLayerData({ [table.id]: table }),
        gpuFilter: table.gpuFilter,
        mapState: { zoom: 6, latitude: -2, longitude: -79 },
        idx: 0,
        visible: true,
      }) as any[];
    }

    /** Sets the first label the way kepler's text label updater does: a new config. */
    function setLabel(layer: any, patch: Record<string, unknown>) {
      layer.updateLayerConfig({ textLabel: [{ ...layer.config.textLabel[0], ...patch }] });
    }

    it('draws none until a column is chosen', () => {
      const table = stationsTable();
      const layers = renderAll(symbolLayer(table), table);

      expect(layers).toHaveLength(1);
    });

    it('labels each drawn symbol with the chosen column, after the symbols', () => {
      const table = stationsTable();
      const layer = symbolLayer(table);
      setLabel(layer, { field: fieldOf(table, 'name') });

      const layers = renderAll(layer, table);
      const label = layers[layers.length - 1];
      const [symbols] = built;

      expect(layers).toHaveLength(2);
      expect(label.id).toBe('symbols-label-name');
      expect(label.props.data).toBe(symbols.data);
      const first = label.props.data.find((row: { index: number }) => row.index === 0);
      expect(label.props.getText(first)).toBe('Cuenca');
      expect([...label.props.characterSet].sort()).toEqual(expect.arrayContaining(['C', 'Q', 'G']));
      // Hidden by the clock with its symbol.
      expect(label.props.getFilterValue).toBe(symbols.getFilterValue);
      expect(label.props.filterRange).toBe(symbols.filterRange);
    });

    it('sets a label beside its symbol, clear of the symbol whatever its size', () => {
      const table = stationsTable();
      const layer = symbolLayer(table, { size: 'speed' });
      setLabel(layer, { field: fieldOf(table, 'name'), anchor: 'start', alignment: 'center' });

      const layers = renderAll(layer, table);
      const label = layers[layers.length - 1];
      const [symbols] = built;
      const quito = label.props.data.find((row: { index: number }) => row.index === 1);
      const cuenca = label.props.data.find((row: { index: number }) => row.index === 0);

      const [quitoX, quitoY] = label.props.getPixelOffset(quito);
      const [cuencaX] = label.props.getPixelOffset(cuenca);
      expect(quitoY).toBe(0);
      expect(quitoX).toBeGreaterThan(symbols.getSize(quito) / 2);
      // The faster wind's larger symbol pushes its label further out.
      expect(quitoX).toBeGreaterThan(cuencaX);
    });
  });

  describe('standing upright', () => {
    /** Renders with the map turned to a bearing, as a user rotating it would. */
    function renderAtBearing(layer: any, table: InstanceType<typeof KeplerTable>, bearing: number) {
      built.length = 0;
      layer.renderLayer({
        data: layer.formatLayerData({ [table.id]: table }),
        gpuFilter: table.gpuFilter,
        mapState: { zoom: 6, latitude: -2, longitude: -79, bearing, pitch: 50 },
        idx: 0,
        visible: true,
      });
      return built;
    }

    it('lies on the map unless asked to stand', () => {
      const table = stationsTable();
      const [props] = renderAtBearing(symbolLayer(table, { angle: 'heading' }), table, 30);

      expect(props.billboard).toBe(false);
      expect(props.getAngle(props.data.find((row: { index: number }) => row.index === 0))).toBe(
        deckAngle(90, 'towards')
      );
    });

    it('faces the camera, with its shadow and outline, when asked to stand', () => {
      const table = stationsTable();
      const layer = symbolLayer(table);
      layer.updateLayerVisConfig({ upright: true, shadow: true, outline: true });

      const drawn = renderAtBearing(layer, table, 0);

      expect(drawn).toHaveLength(3);
      expect(drawn.map((props) => props.billboard)).toEqual([true, true, true]);
    });

    it('keeps a bearing from a column pointing its way on the ground as the map turns', () => {
      // Standing, deck turns a symbol on the screen, not on the ground: the
      // map's own bearing has to be added back, or turning the map would leave
      // every arrow pointing where it pointed before.
      const table = stationsTable();
      const layer = symbolLayer(table, { angle: 'heading' });
      layer.updateLayerVisConfig({ upright: true });

      const [props] = renderAtBearing(layer, table, 30);
      const first = props.data.find((row: { index: number }) => row.index === 0);

      expect(props.getAngle(first)).toBe(deckAngle(90, 'towards') + 30);
      const turned = renderAtBearing(layer, table, 60)[0];
      expect(turned.updateTriggers.getAngle).not.toEqual(props.updateTriggers.getAngle);
    });

    it('keeps a symbol with no bearing column upright on the screen as the map turns', () => {
      // A bus stop or an airport stands straight: a fixed angle is a tilt on
      // the screen, not a direction on the ground.
      const table = stationsTable();
      const layer = symbolLayer(table);
      layer.updateLayerVisConfig({ upright: true, angleDegrees: 0 });

      const [props] = renderAtBearing(layer, table, 30);

      expect(props.getAngle(props.data[0])).toBe(0);
    });
  });

  it('draws the fallback glyph, and asks deck for it by name, when the saved shape is unknown', () => {
    const table = stationsTable();
    const layer = symbolLayer(table);
    layer.updateLayerVisConfig({ symbol: 'a-glyph-no-build-has' });

    const props = render(layer, table);

    expect(props.symbols).toEqual(['arrow']);
    expect(props.getIcon(props.data[0])).toBe('arrow');
  });
});
