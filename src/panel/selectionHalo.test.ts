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

  // kepler alpha.12's `update`, `appendRows` and `upsertRows` change rows in
  // place: the data container stays the same object, `dataRevision` moves.
  it('scans again when the same container is updated in place', () => {
    const rows: unknown[][] = [
      ['site-01', 10],
      ['site-02', 13],
    ];
    const container = {};
    const before = datasetOf(['site', 'value'], rows, container);
    expect(selectedRows({ ...before, revision: 0 }, { site: ['site-03'] })).toEqual([]);

    rows[1] = ['site-03', 16];
    expect(selectedRows({ ...before, revision: 1 }, { site: ['site-03'] })).toEqual([1]);
  });

  it('scans again when the same container gains rows', () => {
    const rows: unknown[][] = [['site-01', 10]];
    const container = {};
    expect(selectedRows(datasetOf(['site', 'value'], rows, container), { site: ['site-02'] })).toEqual([]);

    rows.push(['site-02', 13]);
    expect(selectedRows(datasetOf(['site', 'value'], rows, container), { site: ['site-02'] })).toEqual([1]);
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
    // The layer too: a polygon filter applies only to the layers it targets.
    expect(rowPasses).toHaveBeenCalledWith('A', 1, 'points');
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
    const small = pointsLayer();
    const big = pointsLayer({ id: 'big', radius: { base: 100, fixed: true } });

    for (const layers of [
      [small, big],
      [big, small],
    ]) {
      const { rings } = selectionHalo(inputOf({ layers, zoom: 16 }));
      expect(rings).toHaveLength(1);
      expect(rings[0].radiusPx).toBeGreaterThan(80);
    }
  });

  it('rings each end of a row two point layers draw from different columns', () => {
    // kepler's findPointFieldPairs makes a layer per lat/lng pair: a trip's
    // pickup and its dropoff are two points of one row.
    const trips = datasetOf(
      ['pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng', 'site'],
      [[-2.9, -79.02, -2.88, -79.0, 'site-02']]
    );
    const layers = [
      pointsLayer({ id: 'pickup', columns: { lat: 0, lng: 1 } }),
      pointsLayer({ id: 'dropoff', columns: { lat: 2, lng: 3 } }),
    ];

    expect(selectionHalo(inputOf({ layers, datasets: { A: trips } })).rings).toEqual([
      { position: [-79.02, -2.9], radiusPx: RING_MIN_PX },
      { position: [-79.0, -2.88], radiusPx: RING_MIN_PX },
    ]);
  });

  it('outlines each geometry of a row two GeoJSON layers draw from different columns', () => {
    const origin = { type: 'Point', coordinates: [0, 0] };
    const destination = { type: 'Point', coordinates: [1, 1] };
    const moves = datasetOf(['_origin', '_destination', 'name'], [[origin, destination, 'north']]);
    const layers: HaloLayer[] = [
      { id: 'from', type: 'geojson', isVisible: true, dataId: 'Z', columns: { geojson: 0 } },
      { id: 'to', type: 'geojson', isVisible: true, dataId: 'Z', columns: { geojson: 1 } },
    ];

    expect(selectionHalo(inputOf({ selection: { name: ['north'] }, layers, datasets: { Z: moves } })).shapes).toEqual([
      { kind: 'geojson', value: origin },
      { kind: 'geojson', value: destination },
    ]);
  });

  it('skips a row whose position is not a number', () => {
    const datasets = { A: datasetOf(['latitude', 'longitude', 'site'], [['n/a', -79.02, 'site-02']]) };
    expect(selectionHalo(inputOf({ datasets })).rings).toEqual([]);
  });

  it('reads an empty coordinate as no position, not as zero', () => {
    // Number(null) and Number('') are 0: latitude 0 at longitude −79 is inside
    // Ecuador. kepler checks the raw values and draws no point for these rows.
    for (const empty of [null, undefined, '']) {
      const datasets = { A: datasetOf(['latitude', 'longitude', 'site'], [[empty, empty, 'site-02']]) };
      expect(selectionHalo(inputOf({ datasets })).rings).toEqual([]);
    }
    const onlyLat = { A: datasetOf(['latitude', 'longitude', 'site'], [[-2.9, '', 'site-02']]) };
    expect(selectionHalo(inputOf({ datasets: onlyLat })).rings).toEqual([]);
  });

  it('skips a shape with no geometry in its cell', () => {
    const layers: HaloLayer[] = [
      { id: 'zones', type: 'geojson', isVisible: true, dataId: 'Z', columns: { geojson: 0 } },
    ];
    for (const empty of [null, undefined, '']) {
      const zones = datasetOf(['_geojson', 'name'], [[empty, 'north']]);
      expect(selectionHalo(inputOf({ selection: { name: ['north'] }, layers, datasets: { Z: zones } })).shapes).toEqual(
        []
      );
    }
  });

  it('rings a point layer only while it reads points from lat/lng columns', () => {
    // A layer switched to another column mode keeps its old lat/lng fieldIdx.
    expect(selectionHalo(inputOf({ layers: [pointsLayer({ columnMode: 'geojson' })] })).rings).toEqual([]);
    expect(selectionHalo(inputOf({ layers: [pointsLayer({ columnMode: 'geoarrow' })] })).rings).toEqual([]);
    expect(selectionHalo(inputOf({ layers: [pointsLayer({ columnMode: 'points' })] })).rings).toHaveLength(1);
    expect(selectionHalo(inputOf({ layers: [pointsLayer({ columnMode: undefined })] })).rings).toHaveLength(1);
  });

  it('outlines a GeoJSON layer only while it reads a geometry column', () => {
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
    const zonesLayer = (columnMode?: string): HaloLayer => ({
      id: 'zones',
      type: 'geojson',
      isVisible: true,
      dataId: 'Z',
      columns: { geojson: 0 },
      columnMode,
    });
    const shapesWith = (columnMode?: string) =>
      selectionHalo(
        inputOf({ selection: { name: ['north'] }, layers: [zonesLayer(columnMode)], datasets: { Z: zones } })
      ).shapes;

    expect(shapesWith('table')).toEqual([]);
    expect(shapesWith('geojson')).toHaveLength(1);
    expect(shapesWith(undefined)).toHaveLength(1);
  });

  it("marks nothing when a layer's dataset is missing", () => {
    expect(selectionHalo(inputOf({ datasets: {} }))).toEqual({ rings: [], shapes: [] });
  });
});
