import {
  filterClause,
  filterKey,
  foreignValues,
  intervalScale,
  keplerFilterValue,
  parseViewportColumns,
  viewportExtent,
  type ClauseLike,
} from './mosaicLink';

/**
 * What a map filter says as a clause, and what another panel's clause asks of
 * the map. The quiet cases carry the design: a filter over the whole of its
 * data says nothing, and a window that comes back in different floating point
 * is the same window.
 */

describe('filterClause', () => {
  it('makes an interval of a narrowed range', () => {
    expect(filterClause({ field: 'fare', type: 'range', value: [5, 20], domain: [0, 100] })).toEqual({
      kind: 'interval',
      field: 'fare',
      value: [5, 20],
      time: false,
      domain: [0, 100],
    });
  });

  it('says nothing for a window over the whole data, as kepler seeds a new filter', () => {
    expect(filterClause({ field: 'fare', type: 'range', value: [0, 100], domain: [0, 100] })).toEqual({
      kind: 'open',
      field: 'fare',
    });
  });

  it('marks a time window, in epoch ms', () => {
    const clause = filterClause({ field: 't', type: 'timeRange', value: [2000, 1000], domain: [0, 5000] });
    expect(clause).toMatchObject({ kind: 'interval', value: [1000, 2000], time: true });
  });

  it('makes points of picked values and says nothing for none', () => {
    expect(filterClause({ field: 'borough', type: 'multiSelect', value: ['Queens'] })).toEqual({
      kind: 'points',
      field: 'borough',
      values: ['Queens'],
    });
    expect(filterClause({ field: 'borough', type: 'multiSelect', value: [] })).toEqual({
      kind: 'open',
      field: 'borough',
    });
  });

  it('leaves the other filter types on the map', () => {
    expect(filterClause({ field: 'geom', type: 'polygon', value: {} })).toBeNull();
  });
});

describe('foreignValues', () => {
  type Clause = ClauseLike & { fields: string[] };
  const columnsOf = (clause: ClauseLike) => (clause as Clause).fields;
  const mine = {};
  const isOwn = (source: unknown) => source === mine;

  it('reads a brush and picked values, by column', () => {
    const found = foreignValues(
      [
        { source: {}, value: [new Date(1000), new Date(2000)], meta: { type: 'interval' }, fields: ['t'] },
        { source: {}, value: [['Queens'], ['Bronx']], meta: { type: 'point' }, fields: ['borough'] },
      ] as Clause[],
      columnsOf,
      isOwn
    );
    expect(found.get('t')).toMatchObject({ kind: 'interval', value: [1000, 2000] });
    expect(found.get('borough')).toMatchObject({ kind: 'points', value: ['Queens', 'Bronx'] });
  });

  it('skips the map’s own clauses, cleared ones and two-column ones', () => {
    const found = foreignValues(
      [
        { source: mine, value: [1, 2], meta: { type: 'interval' }, fields: ['fare'] },
        { source: {}, value: null, meta: { type: 'interval' }, fields: ['tip'] },
        {
          source: {},
          value: [
            [0, 1],
            [0, 1],
          ],
          meta: { type: 'interval' },
          fields: ['x', 'y'],
        },
      ] as Clause[],
      columnsOf,
      isOwn
    );
    expect(found.size).toBe(0);
  });

  it('keys a window as the map’s filter keys it, so a landed value is not sent back', () => {
    const [value] = foreignValues(
      [{ source: {}, value: [0.1 + 0.2, 5], meta: { type: 'interval' }, fields: ['fare'] }] as Clause[],
      columnsOf,
      isOwn
    ).values();
    const shown = filterClause({ field: 'fare', type: 'range', value: [0.3, 5], domain: [0, 10] })!;
    expect(value.key).toBe(filterKey(shown));
  });
});

describe('keplerFilterValue', () => {
  it('types picked values as the map’s column holds them', () => {
    const picks = { field: 'f', kind: 'points' as const, value: ['06', 7], key: '' };
    expect(keplerFilterValue(picks, 'string')).toEqual(['06', '7']);
    expect(keplerFilterValue(picks, 'integer')).toEqual([6, 7]);
  });
});

describe('intervalScale', () => {
  it('spans the data so Mosaic can pre-aggregate, in Dates for a time', () => {
    expect(intervalScale({ kind: 'interval', field: 't', value: [1, 2], time: true, domain: [0, 10] })).toEqual({
      type: 'utc',
      domain: [new Date(0), new Date(10)],
      range: [0, 1000],
    });
    expect(intervalScale({ kind: 'interval', field: 'f', value: [1, 2], time: false, domain: null })).toBeUndefined();
  });
});

describe('viewport', () => {
  it('clamps the view to coordinates that exist', () => {
    expect(viewportExtent({ west: -250, south: -95, east: 10.1234567, north: 40 })).toEqual([
      [-180, 10.123457],
      [-90, 40],
    ]);
    expect(viewportExtent(null)).toBeNull();
  });

  it('reads two columns or none', () => {
    expect(parseViewportColumns(' lng , lat ')).toEqual(['lng', 'lat']);
    expect(parseViewportColumns('lng')).toBeNull();
    expect(parseViewportColumns(undefined)).toBeNull();
  });
});
