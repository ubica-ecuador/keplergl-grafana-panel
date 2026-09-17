import { cellAt, keyOf, levelFor, phaseOf, seedOf } from './groundCells';

describe('levelFor', () => {
  it('picks a cell about as wide as the spacing the budget asks for', () => {
    // 9,000 lines over a 1280 × 800 panel is a line every ~11 px; at 1 km per
    // pixel that is ~11 km, which is a shade under 1/8 of a degree.
    const level = levelFor(1_000, 11, 0);
    const degrees = Math.pow(2, -level);

    expect(degrees).toBeGreaterThan(0.05);
    expect(degrees).toBeLessThan(0.2);
  });

  it('asks for finer cells where a pixel covers less ground', () => {
    // The far half of a tilted map: the same spacing in pixels is far less
    // ground, and a level that ignored it would leave the distance bare.
    expect(levelFor(100, 11, 0)).toBeGreaterThan(levelFor(1_000, 11, 0));
  });
});

describe('cellAt', () => {
  it('puts neighbouring points in the same cell and distant ones apart', () => {
    const level = 4; // 1/16 of a degree
    expect(keyOf(cellAt(level, -79.0, -2.0))).toBe(keyOf(cellAt(level, -78.99, -1.99)));
    expect(keyOf(cellAt(level, -79.0, -2.0))).not.toBe(keyOf(cellAt(level, -78.0, -2.0)));
  });
});

describe('seedOf', () => {
  it('always answers the same point for the same cell', () => {
    // The whole of the anchoring: a cell that answered differently twice would
    // move its line under the reader on every pan.
    const cell = cellAt(4, -79, -2);
    expect(seedOf(cell)).toEqual(seedOf(cell));
  });

  it('puts the point inside its own cell', () => {
    const level = 4;
    const size = Math.pow(2, -level);
    const cell = cellAt(level, -79, -2);
    const [lon, lat] = seedOf(cell);

    expect(lon).toBeGreaterThanOrEqual(cell.col * size);
    expect(lon).toBeLessThan((cell.col + 1) * size);
    expect(lat).toBeGreaterThanOrEqual(cell.row * size);
    expect(lat).toBeLessThan((cell.row + 1) * size);
  });

  it('gives neighbouring cells different offsets', () => {
    const a = seedOf(cellAt(4, -79, -2));
    const b = seedOf(cellAt(4, -78.9, -2));
    const size = Math.pow(2, -4);
    expect(Math.abs((a[0] % size) - (b[0] % size))).toBeGreaterThan(1e-6);
  });
});

describe('phaseOf', () => {
  it('gives a cell the same start every time, between nought and one', () => {
    const cell = cellAt(4, -79, -2);
    expect(phaseOf(cell)).toBe(phaseOf(cell));
    expect(phaseOf(cell)).toBeGreaterThanOrEqual(0);
    expect(phaseOf(cell)).toBeLessThan(1);
  });
});
