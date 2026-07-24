import { filterVariableValues, normalizeFilterKey, variableFilterValues } from './variableSync';

const mappings = [
  { field: 'category', variable: 'cat' },
  { field: 'city', variable: 'city' },
];

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
