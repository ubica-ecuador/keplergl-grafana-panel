import {
  decideFieldSync,
  filterVariableValues,
  isRangeMapping,
  isVariableFilter,
  normalizeFilterKey,
  partitionMappings,
  rangeFilterPair,
  rangeVariableWrites,
  readRangeFromVariables,
  variableFilterValues,
} from './variableSync';

const mappings = [
  { field: 'category', variable: 'cat' },
  { field: 'city', variable: 'city' },
];

describe('isVariableFilter', () => {
  it('accepts the filter types whose value maps to a variable', () => {
    expect(isVariableFilter({ name: ['category'], type: 'select', value: 'parks' })).toBe(true);
    expect(isVariableFilter({ name: ['category'], type: 'multiSelect', value: ['parks'] })).toBe(true);
    expect(isVariableFilter({ name: ['city'], type: 'input', value: 'Cuenca' })).toBe(true);
  });

  it('rejects a polygon filter, whose name is layer labels rather than a column', () => {
    // A drawn rectangle becomes a polygon filter named after the LAYERS it
    // applies to. A layer labelled like a mapped column would otherwise feed a
    // GeoJSON Feature into the field sync as if it were that column's value.
    expect(isVariableFilter({ name: ['category'], type: 'polygon', value: { type: 'Feature', geometry: {} } })).toBe(
      false
    );
  });

  it('rejects windows and unknowns', () => {
    expect(isVariableFilter({ name: ['x'], type: 'range', value: [1, 2] })).toBe(false);
    expect(isVariableFilter({ name: ['t'], type: 'timeRange', value: [1, 2] })).toBe(false);
    expect(isVariableFilter({ name: ['x'] })).toBe(false);
  });
});

describe('filterVariableValues', () => {
  it('reads a select filter value into its mapped variable', () => {
    const filters = [{ name: ['category'], type: 'select', value: 'parks' }];
    expect(filterVariableValues(filters, mappings)).toEqual({ cat: 'parks' });
  });

  it('reads a multiSelect filter as an array', () => {
    const filters = [{ name: ['category'], type: 'multiSelect', value: ['parks', 'roads'] }];
    expect(filterVariableValues(filters, mappings)).toEqual({ cat: ['parks', 'roads'] });
  });

  it('reads a text input filter', () => {
    const filters = [{ name: ['city'], type: 'input', value: 'Cuenca' }];
    expect(filterVariableValues(filters, mappings)).toEqual({ city: 'Cuenca' });
  });

  it('maps several filters at once', () => {
    const filters = [
      { name: ['category'], type: 'select', value: 'parks' },
      { name: ['city'], type: 'input', value: 'Cuenca' },
    ];
    expect(filterVariableValues(filters, mappings)).toEqual({ cat: 'parks', city: 'Cuenca' });
  });

  it('ignores filter types that do not map to a variable', () => {
    const filters = [
      { name: ['category'], type: 'range', value: [1, 2] },
      { name: ['city'], type: 'timeRange', value: [1000, 2000] },
    ];
    expect(filterVariableValues(filters, mappings)).toEqual({});
  });

  it('omits a mapping with no matching filter', () => {
    const filters = [{ name: ['category'], type: 'select', value: 'parks' }];
    // Only `cat` is present; `city` has no filter.
    expect(filterVariableValues(filters, mappings)).toEqual({ cat: 'parks' });
  });

  it('omits a filter with an empty value rather than writing a blank variable', () => {
    expect(filterVariableValues([{ name: ['category'], type: 'select', value: null }], mappings)).toEqual({});
    expect(filterVariableValues([{ name: ['category'], type: 'multiSelect', value: [] }], mappings)).toEqual({});
    expect(filterVariableValues([{ name: ['city'], type: 'input', value: '' }], mappings)).toEqual({});
  });

  it('accepts a filter name given as a bare string', () => {
    expect(filterVariableValues([{ name: 'category', type: 'select', value: 'parks' }], mappings)).toEqual({
      cat: 'parks',
    });
  });

  it('returns nothing when there are no mappings', () => {
    expect(filterVariableValues([{ name: ['category'], type: 'select', value: 'parks' }], [])).toEqual({});
  });
});

describe('variableFilterValues', () => {
  it('turns a single-value variable into a one-element filter, keyed by field', () => {
    expect(variableFilterValues({ cat: 'parks' }, mappings)).toEqual({ category: ['parks'], city: null });
  });

  it('turns a multi-value variable into a multi-element filter', () => {
    expect(variableFilterValues({ cat: ['roads', 'schools'] }, mappings)).toEqual({
      category: ['roads', 'schools'],
      city: null,
    });
  });

  it('treats the Grafana "All" value as no filter (null = clear)', () => {
    expect(variableFilterValues({ cat: '$__all' }, mappings).category).toBeNull();
    expect(variableFilterValues({ cat: ['$__all'] }, mappings).category).toBeNull();
  });

  it('treats an absent or empty variable as no filter', () => {
    expect(variableFilterValues({}, mappings).category).toBeNull();
    expect(variableFilterValues({ cat: [] }, mappings).category).toBeNull();
    expect(variableFilterValues({ cat: '' }, mappings).category).toBeNull();
  });

  it('strips the All sentinel out of a mixed value', () => {
    expect(variableFilterValues({ cat: ['$__all', 'roads'] }, mappings).category).toEqual(['roads']);
  });
});

describe('normalizeFilterKey', () => {
  it('gives a single value and its one-element array the same key', () => {
    expect(normalizeFilterKey('parks')).toBe(normalizeFilterKey(['parks']));
  });

  it('is order-independent for multi-values', () => {
    expect(normalizeFilterKey(['roads', 'schools'])).toBe(normalizeFilterKey(['schools', 'roads']));
  });

  it('collapses every empty / All form to one key', () => {
    const all = normalizeFilterKey(null);
    expect(normalizeFilterKey([])).toBe(all);
    expect(normalizeFilterKey('$__all')).toBe(all);
    expect(normalizeFilterKey(['$__all'])).toBe(all);
    expect(normalizeFilterKey(undefined)).toBe(all);
  });

  it('distinguishes different selections', () => {
    expect(normalizeFilterKey(['parks'])).not.toBe(normalizeFilterKey(['roads']));
    expect(normalizeFilterKey(['parks'])).not.toBe(normalizeFilterKey(null));
  });
});

describe('decideFieldSync', () => {
  it('lets a preset variable drive the map on the first pass', () => {
    expect(decideFieldSync({ filterValue: undefined, desired: ['parks'], lastSynced: undefined })).toEqual({
      kind: 'toMap',
      values: ['parks'],
    });
  });

  it('lets the map drive when it carries a filter and no variable is set', () => {
    expect(decideFieldSync({ filterValue: ['parks'], desired: null, lastSynced: undefined })).toEqual({
      kind: 'toVariable',
      value: ['parks'],
    });
  });

  it('does nothing when both sides already say the same thing', () => {
    expect(decideFieldSync({ filterValue: ['parks'], desired: ['parks'], lastSynced: '["parks"]' })).toEqual({
      kind: 'agreed',
    });
  });

  it('publishes the map filter once the map moves away from what both sides agreed on', () => {
    expect(decideFieldSync({ filterValue: ['roads'], desired: ['parks'], lastSynced: '["parks"]' })).toEqual({
      kind: 'toVariable',
      value: ['roads'],
    });
  });

  it('clears the map filter when the variable goes back to All', () => {
    expect(decideFieldSync({ filterValue: ['parks'], desired: null, lastSynced: '["parks"]' })).toEqual({
      kind: 'toMap',
      values: null,
    });
  });

  /**
   * The regression this function exists for.
   *
   * The map is not ready to take a filter yet — no datasets, so no field to
   * filter on — and every pass must keep trying rather than concluding that the
   * map has been set to All and publishing that over the variable. A dashboard
   * opened at `?var-category=parks` used to lose its filter this way within a
   * few hundred milliseconds.
   */
  it('keeps driving the map for as long as the map has not taken the filter', () => {
    let lastSynced: string | undefined;
    const actions = [];

    for (let pass = 0; pass < 3; pass++) {
      const action = decideFieldSync({ filterValue: undefined, desired: ['parks'], lastSynced });
      actions.push(action);
      // The map never accepts it, so nothing is ever recorded as agreed.
      if (action.kind === 'toVariable') {
        lastSynced = normalizeFilterKey(action.value);
      }
    }

    expect(actions).toEqual([
      { kind: 'toMap', values: ['parks'] },
      { kind: 'toMap', values: ['parks'] },
      { kind: 'toMap', values: ['parks'] },
    ]);
  });
});

const rangeMapping = { field: 'speed', variable: 'speedMin', variableTo: 'speedMax' };

describe('isRangeMapping', () => {
  it('needs both a min and a max variable', () => {
    expect(isRangeMapping(rangeMapping)).toBe(true);
  });

  it('rejects a mapping with either variable missing or blank', () => {
    expect(isRangeMapping({ field: 'speed', variable: 'speedMin' })).toBe(false);
    expect(isRangeMapping({ field: 'speed', variable: 'speedMin', variableTo: '' })).toBe(false);
    expect(isRangeMapping({ field: 'speed', variable: '', variableTo: 'speedMax' })).toBe(false);
  });
});

describe('rangeFilterPair', () => {
  it('accepts what a kepler range filter holds: an ordered numeric pair', () => {
    expect(rangeFilterPair([12.5, 80])).toEqual([12.5, 80]);
    expect(rangeFilterPair([-5, 0])).toEqual([-5, 0]);
  });

  it('accepts a degenerate pair (both bounds equal)', () => {
    expect(rangeFilterPair([5, 5])).toEqual([5, 5]);
  });

  it('rejects everything that is not an ordered finite pair', () => {
    expect(rangeFilterPair([80, 12.5])).toBeNull();
    expect(rangeFilterPair([5])).toBeNull();
    expect(rangeFilterPair([1, 2, 3])).toBeNull();
    expect(rangeFilterPair(['12.5', 80])).toBeNull();
    expect(rangeFilterPair([NaN, 2])).toBeNull();
    expect(rangeFilterPair([1, Infinity])).toBeNull();
    expect(rangeFilterPair('12.5,80')).toBeNull();
    expect(rangeFilterPair(null)).toBeNull();
    expect(rangeFilterPair(undefined)).toBeNull();
  });
});

describe('readRangeFromVariables', () => {
  it('reads a numeric pair from the two mapped variables', () => {
    expect(readRangeFromVariables({ speedMin: '12.5', speedMax: '80' }, rangeMapping)).toEqual([12.5, 80]);
  });

  it('accepts numbers, negatives and exponent notation', () => {
    expect(readRangeFromVariables({ speedMin: -5, speedMax: '1e3' }, rangeMapping)).toEqual([-5, 1000]);
  });

  it('takes the first entry when the URL repeats a variable', () => {
    expect(readRangeFromVariables({ speedMin: ['12.5', '99'], speedMax: '80' }, rangeMapping)).toEqual([12.5, 80]);
  });

  it('treats a half-set pair as no window', () => {
    expect(readRangeFromVariables({ speedMin: '12.5' }, rangeMapping)).toBeNull();
    expect(readRangeFromVariables({ speedMax: '80' }, rangeMapping)).toBeNull();
  });

  it('treats empty, All and non-numeric values as no window', () => {
    expect(readRangeFromVariables({ speedMin: '', speedMax: '80' }, rangeMapping)).toBeNull();
    expect(readRangeFromVariables({ speedMin: '$__all', speedMax: '80' }, rangeMapping)).toBeNull();
    expect(readRangeFromVariables({ speedMin: 'abc', speedMax: '80' }, rangeMapping)).toBeNull();
  });

  it('treats an inverted pair as no window rather than a filter that hides everything', () => {
    expect(readRangeFromVariables({ speedMin: '80', speedMax: '12.5' }, rangeMapping)).toBeNull();
  });

  it('returns nothing for a mapping that is not a range mapping', () => {
    expect(
      readRangeFromVariables({ speedMin: '12.5', speedMax: '80' }, { field: 'speed', variable: 'speedMin' })
    ).toBeNull();
  });
});

describe('rangeVariableWrites', () => {
  it('writes each bound to its own variable', () => {
    expect(rangeVariableWrites([12.5, 80], rangeMapping)).toEqual({ speedMin: '12.5', speedMax: '80' });
  });

  it('writes both variables blank when the filter is gone', () => {
    // An explicit "no restriction" publish: leaving the old values in place
    // would freeze the arbitration — the variables could never drive again
    // because neither side would ever match the last agreement.
    expect(rangeVariableWrites(null, rangeMapping)).toEqual({ speedMin: '', speedMax: '' });
  });

  it('writes nothing for a mapping that is not a range mapping', () => {
    expect(rangeVariableWrites([12.5, 80], { field: 'speed', variable: 'speedMin' })).toEqual({});
  });
});

/**
 * The range path reuses the select path's arbitration wholesale: a numeric pair
 * and its two-variable string form must land on the same canonical key, so
 * `decideFieldSync` can cut the echo between them without knowing about ranges.
 */
describe('range values through the shared arbitration', () => {
  it('gives a numeric pair and its string form the same key', () => {
    expect(normalizeFilterKey([12.5, 80])).toBe(normalizeFilterKey(['12.5', '80']));
  });

  it('agrees once the map filter matches what the variables say', () => {
    expect(
      decideFieldSync({
        filterValue: [12.5, 80],
        desired: ['12.5', '80'],
        lastSynced: normalizeFilterKey([12.5, 80]),
      })
    ).toEqual({ kind: 'agreed' });
  });

  it('lets preset range variables drive the map on the first pass', () => {
    expect(decideFieldSync({ filterValue: undefined, desired: ['12.5', '80'], lastSynced: undefined })).toEqual({
      kind: 'toMap',
      values: ['12.5', '80'],
    });
  });
});

describe('partitionMappings', () => {
  it('splits mappings by the state that drives them', () => {
    const scalar = { field: 'category', variable: 'cat' };
    const range = { field: 'value', variable: 'valueMin', variableTo: 'valueMax' };
    const click = { field: 'vehicle_id', variable: 'vehicle', source: 'click' as const };
    expect(partitionMappings([scalar, range, click])).toEqual({
      scalar: [scalar],
      range: [range],
      click: [click],
    });
  });

  it('keeps a click mapping out of the range set even when it names a Max variable', () => {
    // A click mapping is one-way map → variable; letting its stray variableTo
    // promote it to a range mapping would have the variable pair create a
    // filter on the map, which no click ever asked for.
    const mapping = { field: 'vehicle_id', variable: 'vehicle', variableTo: 'stray', source: 'click' as const };
    expect(partitionMappings([mapping])).toEqual({ scalar: [], range: [], click: [mapping] });
  });

  it('reads an absent source as filter-driven', () => {
    const mapping = { field: 'category', variable: 'cat', source: 'filter' as const };
    expect(partitionMappings([mapping]).scalar).toEqual([mapping]);
  });
});
