import { EVERY_QUERY, queryOptionsFor, resolveQueryOptions, withQueryOptionsMoved } from './queryOptions';

describe('queryOptionsFor', () => {
  it('takes a query’s own value, then what every query takes, then the defaults', () => {
    const options = {
      queryOptions: {
        A: { tripLayerMode: 'table' as const },
        [EVERY_QUERY]: { tripLayerMode: 'geojson' as const, gazetteer: 'public/gazetteer/airports.geojson' },
      },
    };
    expect(queryOptionsFor(options, 'A')).toEqual({
      tripLayerMode: 'table',
      gazetteer: 'public/gazetteer/airports.geojson',
    });
    expect(queryOptionsFor(options, 'B')).toEqual({
      tripLayerMode: 'geojson',
      gazetteer: 'public/gazetteer/airports.geojson',
    });
    expect(queryOptionsFor({}, 'A')).toEqual({});
  });

  it('still reads the panel-wide values of 1.9 on a panel the migration did not reach', () => {
    const legacy = { tripLayerMode: 'geojson' as const, gazetteer: 'https://example.org/stations.json' };
    expect(resolveQueryOptions(legacy, ['A', 'B'])).toEqual({
      A: legacy,
      B: legacy,
    });
    // A query's own value wins over them.
    expect(queryOptionsFor({ ...legacy, queryOptions: { A: { tripLayerMode: 'table' } } }, 'A').tripLayerMode).toBe(
      'table'
    );
  });
});

describe('withQueryOptionsMoved', () => {
  it('returns options without the old keys as they were', () => {
    const options = { basemap: 'positron' };
    expect(withQueryOptionsMoved(options)).toBe(options);
  });

  it('keeps what an entry for every query already sets', () => {
    const moved = withQueryOptionsMoved({
      gazetteer: 'public/gazetteer/usa-states.json',
      queryOptions: { [EVERY_QUERY]: { gazetteer: 'public/gazetteer/airports.geojson' } },
    });
    expect(moved).toEqual({ queryOptions: { [EVERY_QUERY]: { gazetteer: 'public/gazetteer/airports.geojson' } } });
  });
});
