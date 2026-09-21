import {
  pointRadiusPx,
  RING_MIN_PX,
  selectedRows,
  selectionHalo,
  type HaloDataset,
  type HaloInput,
  type HaloLayer,
} from './selectionHalo';

/**
 * Which rows are the dashboard's selection, and where on the map to mark them.
 * Plain objects throughout: a dataset is a list of column names and a table of
 * values, and `valueAt` is a mock so the cache can be seen doing its job.
 */

type MockDataset = HaloDataset & { valueAt: jest.Mock };

function datasetOf(fieldNames: string[], rows: unknown[][], cacheKey: object = {}): MockDataset {
  return {
    fieldNames,
    numRows: rows.length,
    valueAt: jest.fn((row: number, column: number) => rows[row][column]),
    cacheKey,
  };
}

const sites = () =>
  datasetOf(
    ['site', 'value'],
    [
      ['site-01', 10],
      ['site-02', 13],
      ['site-03', 16],
    ]
  );

describe('selectedRows', () => {
  it('finds the rows whose column holds a selected value', () => {
    expect(selectedRows(sites(), { site: ['site-02'] })).toEqual([1]);
  });

  it('reads 13 in the row and "13" in the URL as the same value', () => {
    expect(selectedRows(sites(), { value: ['13'] })).toEqual([1]);
  });

  it('selects every value of a multi-value variable', () => {
    expect(selectedRows(sites(), { site: ['site-01', 'site-03'] })).toEqual([0, 2]);
  });

  it('takes the union over several selected columns', () => {
    expect(selectedRows(sites(), { site: ['site-01'], value: ['16'] })).toEqual([0, 2]);
  });

  it('selects nothing in a dataset that lacks the column', () => {
    expect(selectedRows(sites(), { vehicle: ['v7'] })).toEqual([]);
  });

  it('never matches an empty cell', () => {
    const dataset = datasetOf(['site'], [[null], [undefined], ['site-01']]);
    expect(selectedRows(dataset, { site: ['null', 'undefined', 'site-01'] })).toEqual([2]);
  });

  it('ignores a column with no values selected', () => {
    expect(selectedRows(sites(), { site: [] })).toEqual([]);
  });
});

describe('selectedRows cache', () => {
  it('scans a dataset once for the same selection, however often it is asked', () => {
    const dataset = sites();
    selectedRows(dataset, { site: ['site-02'] });
    const scanned = dataset.valueAt.mock.calls.length;

    selectedRows(dataset, { site: ['site-02'] });
    // kepler copies the dataset object on every filter change but keeps its
    // data container: a copy with the same key is the same data.
    selectedRows({ ...dataset }, { site: ['site-02'] });

    expect(dataset.valueAt.mock.calls.length).toBe(scanned);
  });

  it('scans again when the selection changes', () => {
    const dataset = sites();
    selectedRows(dataset, { site: ['site-02'] });
    const scanned = dataset.valueAt.mock.calls.length;

    expect(selectedRows(dataset, { site: ['site-03'] })).toEqual([2]);
    expect(dataset.valueAt.mock.calls.length).toBeGreaterThan(scanned);
  });

  it('scans again when the data changes', () => {
    const first = sites();
    selectedRows(first, { site: ['site-02'] });

    const refreshed = datasetOf(['site', 'value'], [['site-02', 99]], {});
    expect(selectedRows(refreshed, { site: ['site-02'] })).toEqual([0]);
    expect(refreshed.valueAt).toHaveBeenCalled();
  });
});

describe('pointRadiusPx', () => {
  // kepler draws points in metres: radius × 2^max(14 − zoom, 0), or the radius
  // itself when fixed. A web-mercator pixel is C·cos(lat) / (512 · 2^zoom) metres.
  it('keeps a default point a couple of pixels wide below zoom 14', () => {
    expect(pointRadiusPx({ base: 10, fixed: false }, 13, 0)).toBeCloseTo(2.093, 2);
  });

  it('grows the point with the zoom above 14', () => {
    expect(pointRadiusPx({ base: 10, fixed: false }, 16, 0)).toBeCloseTo(8.373, 2);
  });

  it('reads a fixed radius as metres on the ground at every zoom', () => {
    expect(pointRadiusPx({ base: 100, fixed: true }, 16, 0)).toBeCloseTo(83.73, 1);
  });

  it('makes a point wider on screen away from the equator', () => {
    expect(pointRadiusPx({ base: 10, fixed: false }, 16, 60)).toBeCloseTo(16.75, 1);
  });
});

describe('selectionHalo', () => {
  const pointsLayer = (over: Partial<HaloLayer> = {}): HaloLayer => ({
    id: 'points',
    type: 'point',
    isVisible: true,
    dataId: 'A',
    columns: { lat: 0, lng: 1 },
    radius: { base: 10, fixed: false },
    ...over,
  });

  const stations = () =>
    datasetOf(
      ['latitude', 'longitude', 'site'],
      [
        [-2.9, -79.02, 'site-01'],
        [-2.895, -79.02, 'site-02'],
      ]
    );

  function inputOf(over: Partial<HaloInput> = {}): HaloInput {
    return {
      selection: { site: ['site-02'] },
      layers: [pointsLayer()],
      datasets: { A: stations() },
      rowPasses: () => true,
      sideLayers: null,
      zoom: 13,
      ...over,
    };
  }

  it('rings the selected point, never smaller than the minimum', () => {
    expect(selectionHalo(inputOf())).toEqual({
      rings: [{ position: [-79.02, -2.895], radiusPx: RING_MIN_PX }],
      shapes: [],
    });
  });

  it('draws the ring outside a point that is large on screen', () => {
    const [ring] = selectionHalo(inputOf({ zoom: 16 })).rings;
    // 8.38 px of point at this latitude, plus the 6 px margin.
    expect(ring.radiusPx).toBeCloseTo(14.38, 1);
  });

  it('rings nothing on a hidden layer', () => {
    expect(selectionHalo(inputOf({ layers: [pointsLayer({ isVisible: false })] })).rings).toEqual([]);
  });

  it('rings nothing on the side of a split map that does not show the layer', () => {
    expect(selectionHalo(inputOf({ sideLayers: { points: false } })).rings).toEqual([]);
    expect(selectionHalo(inputOf({ sideLayers: {} })).rings).toEqual([]);
    expect(selectionHalo(inputOf({ sideLayers: { points: true } })).rings).toHaveLength(1);
  });

  it("rings nothing that kepler's filters leave out", () => {
    const rowPasses = jest.fn(() => false);
    expect(selectionHalo(inputOf({ rowPasses })).rings).toEqual([]);
    expect(rowPasses).toHaveBeenCalledWith('A', 1);
  });

  it('outlines a selected GeoJSON feature', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    const zones = datasetOf(['_geojson', 'name'], [[polygon, 'north']]);
    const layers: HaloLayer[] = [
      { id: 'zones', type: 'geojson', isVisible: true, dataId: 'Z', columns: { geojson: 0 } },
    ];

    expect(selectionHalo(inputOf({ selection: { name: ['north'] }, layers, datasets: { Z: zones } }))).toEqual({
      rings: [],
      shapes: [{ kind: 'geojson', value: polygon }],
    });
  });

  it('outlines a selected H3 cell', () => {
    const cells = datasetOf(['h3', 'value'], [['888f7699adfffff', 62]]);
    const layers: HaloLayer[] = [
      { id: 'hex', type: 'hexagonId', isVisible: true, dataId: 'H', columns: { hex_id: 0 } },
    ];

    expect(selectionHalo(inputOf({ selection: { h3: ['888f7699adfffff'] }, layers, datasets: { H: cells } }))).toEqual({
      rings: [],
      shapes: [{ kind: 'hexagon', value: '888f7699adfffff' }],
    });
  });

  it('marks nothing on the layer types the first version leaves out', () => {
    for (const type of ['arc', 'flow', 'heatmap', 'trip', 'symbol', 'hexagon']) {
      expect(selectionHalo(inputOf({ layers: [pointsLayer({ type })] }))).toEqual({ rings: [], shapes: [] });
    }
  });

  it('rings a row once when two layers draw it, keeping the larger ring', () => {
    const layers = [pointsLayer(), pointsLayer({ id: 'big', radius: { base: 100, fixed: true } })];
    const { rings } = selectionHalo(inputOf({ layers, zoom: 16 }));

    expect(rings).toHaveLength(1);
    expect(rings[0].radiusPx).toBeGreaterThan(80);
  });

  it('skips a row whose position is not a number', () => {
    const datasets = { A: datasetOf(['latitude', 'longitude', 'site'], [['n/a', -79.02, 'site-02']]) };
    expect(selectionHalo(inputOf({ datasets })).rings).toEqual([]);
  });

  it('skips a shape with no geometry in its cell', () => {
    const zones = datasetOf(['_geojson', 'name'], [[null, 'north']]);
    const layers: HaloLayer[] = [
      { id: 'zones', type: 'geojson', isVisible: true, dataId: 'Z', columns: { geojson: 0 } },
    ];
    expect(selectionHalo(inputOf({ selection: { name: ['north'] }, layers, datasets: { Z: zones } })).shapes).toEqual(
      []
    );
  });

  it("marks nothing when a layer's dataset is missing", () => {
    expect(selectionHalo(inputOf({ datasets: {} }))).toEqual({ rings: [], shapes: [] });
  });
});
