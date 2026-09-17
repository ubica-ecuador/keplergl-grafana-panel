/**
 * The ground cells a streamline belongs to.
 *
 * A line is anchored to a patch of ground rather than to a pixel, so the same
 * patch always yields the same line, born in the same place and at the same
 * point of its cycle. That is what lets a pan reuse what was already traced,
 * and what stops a change of forecast hour reshuffling the whole field: the
 * lines change shape, not place.
 *
 * Cells are a power-of-two fraction of a degree so that a level is a number
 * and a cell's neighbours at the same level always line up. Pure: no deck, no
 * kepler, nothing about the screen except the scale handed in.
 */

export interface Cell {
  level: number;
  col: number;
  row: number;
}

const METRES_PER_DEGREE = 111_320;

/** How wide a cell is at a level, in degrees. */
export function sizeAt(level: number): number {
  return Math.pow(2, -level);
}

/**
 * The level whose cell is about `spacingPx` pixels across.
 *
 * Handed the metres a pixel covers *where the cell will be*, which on a tilted
 * map is not the same up the screen as down it — that difference is what the
 * caller's bands exist to measure.
 */
export function levelFor(metresPerPixel: number, spacingPx: number, latitude: number): number {
  const metres = Math.max(1e-3, metresPerPixel * Math.max(1, spacingPx));
  const east = METRES_PER_DEGREE * Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const degrees = metres / east;
  return Math.max(0, Math.round(Math.log2(1 / degrees)));
}

/** The cell a point falls in. */
export function cellAt(level: number, lon: number, lat: number): Cell {
  const size = sizeAt(level);
  return { level, col: Math.floor(lon / size), row: Math.floor(lat / size) };
}

export function keyOf(cell: Cell): string {
  return `${cell.level}:${cell.col}:${cell.row}`;
}

/** A number from a cell's key, the same every time. */
function hashOf(cell: Cell): number {
  let hash = 2166136261;
  for (const value of [cell.level, cell.col, cell.row]) {
    hash ^= value | 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Two numbers between 0 and 1 from that hash. */
function pairFrom(hash: number): [number, number] {
  const first = (hash >>> 8) / 16777216;
  const second = ((Math.imul(hash, 1103515245) + 12345) >>> 8) / 16777216;
  return [first, second];
}

/**
 * Where inside its cell a line is born.
 *
 * Kept off the cell's own corner: lines all born at their corners draw the
 * lattice itself, which reads as a grid of the tool rather than a field of the
 * data.
 */
export function seedOf(cell: Cell): [number, number] {
  const size = sizeAt(cell.level);
  const [x, y] = pairFrom(hashOf(cell));
  return [(cell.col + 0.15 + x * 0.7) * size, (cell.row + 0.15 + y * 0.7) * size];
}

/** Where in the cycle this cell's trail starts, from 0 to 1. */
export function phaseOf(cell: Cell): number {
  return pairFrom(hashOf({ ...cell, level: cell.level + 101 }))[0];
}
