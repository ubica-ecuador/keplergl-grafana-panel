import { rulesToColors } from './geojsonRules';

const GREY = '#808080';

describe('rulesToColors', () => {
  it('gives each value of a property its colour when every rule is an equality', () => {
    expect(
      rulesToColors(
        [
          { check: { property: 'name', operation: 'eq', value: 'Ecuador' }, color: '#ff0000' },
          { check: { property: 'name', operation: 'eq', value: 'Peru' }, color: '#ffff00' },
          { check: { property: 'name', operation: 'eq', value: 'Ecuador' }, color: '#0000ff' },
        ],
        GREY
      )
    ).toEqual({
      property: 'name',
      scale: 'customOrdinal',
      colors: ['#ff0000', '#ffff00', GREY],
      // The first rule for a value wins, as in Geomap.
      colorMap: [
        ['Ecuador', '#ff0000'],
        ['Peru', '#ffff00'],
      ],
    });
  });

  it('cuts the number line at the compared values, each stretch taking the first rule that matches it', () => {
    const colors = rulesToColors(
      [
        { check: { property: 'density', operation: 'gt', value: 100 }, color: 'red' },
        { check: { property: 'density', operation: 'gt', value: 50 }, color: 'yellow' },
      ],
      'green'
    );
    expect(colors).toEqual({
      property: 'density',
      scale: 'custom',
      colors: ['green', 'yellow', 'red'],
      colorMap: [
        [50, 'green'],
        [100, 'yellow'],
        [null, 'red'],
      ],
    });
  });

  it('reads numbers written as text, as Geomap’s editor saves them', () => {
    const colors = rulesToColors(
      [{ check: { property: 'density', operation: 'lt', value: '10' }, color: 'blue' }],
      GREY
    );
    expect(colors?.colorMap).toEqual([
      [10, 'blue'],
      [null, GREY],
    ]);
  });

  it('gives up on rules over two properties, or equalities mixed with comparisons', () => {
    expect(
      rulesToColors(
        [
          { check: { property: 'a', operation: 'eq', value: 1 }, color: 'red' },
          { check: { property: 'b', operation: 'eq', value: 1 }, color: 'red' },
        ],
        GREY
      )
    ).toBeNull();
    expect(
      rulesToColors(
        [
          { check: { property: 'a', operation: 'eq', value: 1 }, color: 'red' },
          { check: { property: 'a', operation: 'gt', value: 5 }, color: 'red' },
        ],
        GREY
      )
    ).toBeNull();
  });
});
