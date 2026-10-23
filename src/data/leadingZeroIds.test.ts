import { processRowObject } from '@kepler.gl/processors';

import { keepLeadingZeroIds } from './leadingZeroIds';

/**
 * Identifiers that are digits with a leading zero survive kepler's typing, run
 * through kepler's own `processRowObject` as the panel runs it.
 */

function load(rows: Array<Record<string, unknown>>) {
  const data = processRowObject(rows)!;
  keepLeadingZeroIds(data, rows);
  return data;
}

describe('keepLeadingZeroIds', () => {
  it('keeps a census tract with its leading zero, as text', () => {
    const data = load([
      { geoid: '06047001901', share: 1.5 },
      { geoid: '17031151200', share: 2 },
    ]);
    const geoid = data.fields.find((f) => f.name === 'geoid')!;
    expect(geoid.type).toBe('string');
    expect(data.rows.map((row) => row[0])).toEqual(['06047001901', '17031151200']);
  });

  it('leaves kepler to parse numeric text that a number does not change', () => {
    const data = load([
      { latitude: '-2.9', count: '17' },
      { latitude: '0.5', count: '3' },
    ]);
    expect(data.fields.map((f) => f.type)).toEqual(['real', 'integer']);
    expect(data.rows[0]).toEqual([-2.9, 17]);
  });

  it('leaves real numbers alone', () => {
    const data = load([{ zip: 1234 }, { zip: 501 }]);
    expect(data.fields[0].type).toBe('integer');
    expect(data.rows.map((row) => row[0])).toEqual([1234, 501]);
  });
});
