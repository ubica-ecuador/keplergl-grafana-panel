import { LayerClasses } from '@kepler.gl/layers';
import { processRowObject } from '@kepler.gl/processors';
import KeplerTable from '@kepler.gl/table';

import { CELLS_TYPE, makeCellsLayer } from './cellsLayer';

/**
 * The Cells layer on kepler's real Hexbin, over a real `KeplerTable`: what the subclass changes (its type, its knobs,
 * its colour scales) and what it hands deck. The binning and the drawing are checked in a browser; deck's layers need
 * a GL context to update.
 */

const CellsLayer = makeCellsLayer(LayerClasses.hexagon, 'icon') as unknown as new (
  props: Record<string, unknown>
) => any;

const rows = [
  { latitude: -2.9, longitude: -79.0, frp: 4 },
  { latitude: -2.91, longitude: -79.01, frp: 9 },
  { latitude: -0.19, longitude: -78.48, frp: 1 },
];

const COLOUR_RANGE = {
  name: 'Test',
  type: 'sequential',
  category: 'Test',
  colors: ['#5a1846', '#900c3f', '#c70039', '#e3611c', '#f1920e', '#ffc300'],
};

function table(): InstanceType<typeof KeplerTable> {
  const t = new KeplerTable({ info: { id: 'fires', label: 'Fires' }, color: [0, 92, 255] });
  t.updateSchema(processRowObject(rows) as never);
  return t;
}

function cellsLayer(t: InstanceType<typeof KeplerTable>) {
  const column = (name: string) => ({ value: name, fieldIdx: t.getColumnFieldIdx(name) });
  return new CellsLayer({ id: 'cells', dataId: t.id, columns: { lat: column('latitude'), lng: column('longitude') } });
}

describe('Cells layer on kepler’s real Hexbin', () => {
  it('is its own type, with the grid knobs at their defaults', () => {
    const layer = cellsLayer(table());
    expect(layer.type).toBe(CELLS_TYPE);
    expect(layer.layerIcon).toBe('icon');
    expect(layer.config.visConfig).toMatchObject({
      cellSystem: 'h3',
      cellPixels: 36,
      cellTransition: 400,
      cellDensity: false,
    });
    // The Hexbin's Radius group draws this setting: here it is the cell size.
    expect(layer.visConfigSettings.worldUnitSize.property).toBe('cellPixels');
  });

  it('claims no dataset by itself', () => {
    expect((CellsLayer as unknown as { findDefaultLayerProps(): unknown }).findDefaultLayerProps()).toEqual({
      props: [],
    });
  });

  it('offers Log and Sqrt after the Hexbin’s colour scales', () => {
    const options = cellsLayer(table()).getScaleOptions('color');
    expect(options).toEqual(expect.arrayContaining(['quantize', 'quantile', 'log', 'sqrt']));
  });

  it('gives the legend a threshold scale for Log, with bounds spaced by ratio', () => {
    const scale = cellsLayer(table()).getColorScale('log', [1, 525], COLOUR_RANGE);
    expect(scale.scaleType).toBe('threshold');
    expect(scale.domain()).toEqual([2.8, 8.1, 23, 65, 180]);
    expect(scale(500)).toEqual([255, 195, 0]);
  });

  it('leaves the other scales to kepler', () => {
    const scale = cellsLayer(table()).getColorScale('quantize', [0, 6], COLOUR_RANGE);
    expect(scale.scaleType).not.toBe('threshold');
    expect(scale(5.9)).toEqual([255, 195, 0]);
  });

  it('hands deck its rows, the dataset, the grid and the scale the legend draws', () => {
    const t = table();
    const layer = cellsLayer(t);
    layer.updateLayerVisConfig({ cellSystem: 'a5', cellPixels: 20, cellTransition: 0 });
    const data = layer.formatLayerData({ [t.id]: t });
    const [deck] = layer.renderLayer({
      data,
      gpuFilter: t.gpuFilter,
      mapState: { zoom: 6, latitude: -2, longitude: -79 },
      idx: 0,
      visible: true,
    });
    expect(deck.props.data).toHaveLength(3);
    expect(deck.props.cellSource).toBe(t.dataContainer);
    expect(deck.props).toMatchObject({
      cellSystem: 'a5',
      cellPixels: 20,
      cellTransition: 0,
      cellColorScale: 'quantile',
    });
    expect(typeof deck.props.colorScaleOf).toBe('function');
    expect(deck.props.colorScaleOf('log', [1, 525])(1)).toEqual(expect.any(Array));
  });
});
