import { filterVariableValues } from './variableSync';

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
