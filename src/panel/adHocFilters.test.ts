import { FieldType, type DataFrame } from '@grafana/data';

import { adHocFilterItem, entityFilters, filterValueOf, offersAdHocFilters } from './adHocFilters';

/** A query result with a category, a number and a place. */
const frame: DataFrame = {
  refId: 'A',
  length: 2,
  fields: [
    { name: 'kind', type: FieldType.string, config: {}, values: ['shop', 'school'] },
    { name: 'floors', type: FieldType.number, config: {}, values: [3, 1] },
    { name: 'lat', type: FieldType.number, config: {}, values: [-2.9, -2.8] },
    { name: 'geom', type: FieldType.other, config: {}, values: [{ type: 'Point' }, { type: 'Point' }] },
  ],
};

describe('offersAdHocFilters', () => {
  it('offers filters when fields are named and the dashboard has a variable for the datasource', () => {
    // An empty list: the variable exists, nothing is filtered yet.
    expect(offersAdHocFilters({ fields: ['kind'], requestFilters: [], canAdd: true })).toBe(true);
  });

  it('offers nothing without an ad hoc variable for the datasource', () => {
    // Grafana leaves request.filters unset then; onAddAdHocFilter would create a variable the datasource may ignore.
    expect(offersAdHocFilters({ fields: ['kind'], requestFilters: undefined, canAdd: true })).toBe(false);
  });

  it('offers nothing outside a dashboard, where the panel context cannot add one', () => {
    expect(offersAdHocFilters({ fields: ['kind'], requestFilters: [], canAdd: false })).toBe(false);
  });

  it('offers nothing when no field is named', () => {
    expect(offersAdHocFilters({ fields: [], requestFilters: [], canAdd: true })).toBe(false);
    expect(offersAdHocFilters({ fields: undefined, requestFilters: [], canAdd: true })).toBe(false);
  });
});

describe('filterValueOf', () => {
  it('writes the raw value as text, as the table does', () => {
    expect(filterValueOf('shop')).toBe('shop');
    expect(filterValueOf(3)).toBe('3');
    expect(filterValueOf(0)).toBe('0');
    expect(filterValueOf(false)).toBe('false');
  });

  it('offers no filter for a missing value or one no datasource compares with =', () => {
    expect(filterValueOf(null)).toBeUndefined();
    expect(filterValueOf(undefined)).toBeUndefined();
    expect(filterValueOf('')).toBeUndefined();
    expect(filterValueOf({ type: 'Point' })).toBeUndefined();
  });

  it('writes a date as epoch milliseconds, the value Grafana holds for a time field', () => {
    expect(filterValueOf(new Date(Date.UTC(2026, 0, 1)))).toBe('1767225600000');
  });
});

describe('entityFilters', () => {
  it('offers the named fields of the clicked row, in the order named', () => {
    const filters = entityFilters({
      frame,
      values: { kind: 'school', floors: 1, lat: -2.8 },
      fields: ['floors', 'kind'],
      active: [],
    });
    expect(filters).toEqual([
      { key: 'floors', value: '1', filteredFor: false, filteredOut: false },
      { key: 'kind', value: 'school', filteredFor: false, filteredOut: false },
    ]);
  });

  it('keys the filter by the query’s column even where kepler renamed it', () => {
    const filters = entityFilters({
      frame,
      values: { latitude: -2.8, kind: 'school' },
      renames: { lat: 'latitude' },
      fields: ['lat'],
      active: [],
    });
    expect(filters).toEqual([{ key: 'lat', value: '-2.8', filteredFor: false, filteredOut: false }]);
  });

  it('skips a field the entity’s query lacks, a missing value and a geometry', () => {
    const filters = entityFilters({
      frame,
      values: { kind: null, geom: { type: 'Point' } },
      fields: ['station', 'kind', 'geom'],
      active: [],
    });
    expect(filters).toEqual([]);
  });

  it('names a field once however often it is listed', () => {
    const filters = entityFilters({ frame, values: { kind: 'shop' }, fields: ['kind', 'kind'], active: [] });
    expect(filters.map((f) => f.key)).toEqual(['kind']);
  });

  it('says which filter the dashboard already applies', () => {
    const filters = entityFilters({
      frame,
      values: { kind: 'shop', floors: 3 },
      fields: ['kind', 'floors'],
      active: [
        { key: 'kind', operator: '=', value: 'shop' },
        { key: 'floors', operator: '!=', value: '3' },
        // Another value of the same key changes nothing for this entity.
        { key: 'kind', operator: '!=', value: 'school' },
      ],
    });
    expect(filters).toEqual([
      { key: 'kind', value: 'shop', filteredFor: true, filteredOut: false },
      { key: 'floors', value: '3', filteredFor: false, filteredOut: true },
    ]);
  });
});

describe('adHocFilterItem', () => {
  it('is the item Grafana’s table hands onAddAdHocFilter', () => {
    expect(adHocFilterItem({ key: 'kind', value: 'shop' }, '=')).toEqual({ key: 'kind', value: 'shop', operator: '=' });
    expect(adHocFilterItem({ key: 'kind', value: 'shop' }, '!=')).toEqual({
      key: 'kind',
      value: 'shop',
      operator: '!=',
    });
  });
});
