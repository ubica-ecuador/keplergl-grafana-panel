/**
 * Which of kepler's filters belong to a chart.
 *
 * A chart in kepler's charts panel cross-filters the map by adding ordinary
 * filters: clicking a bar sets a filter on the bar's field. The panel's syncs
 * read kepler's filters to drive dashboard variables and the dashboard's time
 * range. A chart's filter is meant to narrow the map and its charts only, so
 * every sync leaves it out.
 *
 * It matters twice over. The variable sync matches filters by field name, so a
 * chart filtering a mapped field would publish to the variable. And the time
 * sync takes the first `timeRange` filter it finds as the map's clock, so a
 * chart filtering a time field could become the clock and move the dashboard's
 * time range.
 *
 * A chart owns up to three filters: `crossFilter.filterId`, plus `-x` and `-y`
 * for a two-axis chart. That is the list kepler's own `removeChartsAndFilters`
 * removes with the chart.
 */

/** The only part of a chart this reads. */
export interface ChartLike {
  crossFilter?: { filterId?: string | null } | null;
}

/** The ids of every filter the given charts own. */
export function chartFilterIds(charts: ReadonlyArray<ChartLike | null | undefined>): Set<string> {
  const ids = new Set<string>();
  for (const chart of charts) {
    const id = chart?.crossFilter?.filterId;
    if (id) {
      ids.add(id);
      ids.add(`${id}-x`);
      ids.add(`${id}-y`);
    }
  }
  return ids;
}

/** `filters` without the ones in `chartIds`; the same array when there are none. */
export function withoutChartFilters<F extends { id?: string }>(
  filters: readonly F[],
  chartIds: ReadonlySet<string>
): F[] {
  if (chartIds.size === 0) {
    return filters as F[];
  }
  return filters.filter((filter) => !(filter.id && chartIds.has(filter.id)));
}

/**
 * Only the filters in `chartIds`: what a `chart` variable mapping reads. Those
 * mappings are the one opt-in way for a chart's cross-filter to reach the
 * dashboard, by the author's choice, mapping by mapping.
 */
export function onlyChartFilters<F extends { id?: string }>(filters: readonly F[], chartIds: ReadonlySet<string>): F[] {
  return filters.filter((filter) => Boolean(filter.id && chartIds.has(filter.id)));
}
