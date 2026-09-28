import { chartFilterIds, withoutChartFilters } from './chartFilters';

/**
 * A chart's cross-filter is an ordinary kepler filter. kepler names it after
 * the chart's `crossFilter.filterId`, and a two-axis chart adds `-x` and `-y`
 * for its second and third; `removeChartsAndFilters` in kepler's
 * vis-state-updaters removes exactly those three when the chart goes.
 */
describe('chartFilterIds', () => {
  it('names the three filters a chart can own', () => {
    expect(chartFilterIds([{ crossFilter: { filterId: 'bars' } }])).toEqual(new Set(['bars', 'bars-x', 'bars-y']));
  });

  it('names nothing for charts without a cross-filter', () => {
    expect(chartFilterIds([{}, { crossFilter: null }, { crossFilter: { filterId: '' } }, null, undefined])).toEqual(
      new Set()
    );
  });
});

describe('withoutChartFilters', () => {
  const own = { id: 'sitio' };
  const chart = { id: 'bars-x' };

  it('drops the filters a chart owns and keeps the rest in order', () => {
    expect(withoutChartFilters([chart, own], new Set(['bars', 'bars-x', 'bars-y']))).toEqual([own]);
  });

  it('hands the same list back when no chart owns anything', () => {
    const filters = [own, chart];
    expect(withoutChartFilters(filters, new Set())).toBe(filters);
  });
});
