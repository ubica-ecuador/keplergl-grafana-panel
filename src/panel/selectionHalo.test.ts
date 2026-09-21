import { selectedRows, type HaloDataset } from './selectionHalo';

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
