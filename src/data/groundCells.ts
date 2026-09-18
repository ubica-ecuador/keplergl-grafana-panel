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

/**
 * How far below level 0 a cell is allowed to grow.
 *
 * Without a floor, a camera zoomed out to see most of the planet asks for a
 * cell sized to what a whole screen's worth of pixels covers, which is
 * degrees enough that `2^-level` and the loop that walks a screen's worth of
 * them both stop being sane. A cell this coarse (`sizeAt(MIN_LEVEL)` degrees)
 * is already far bigger than any field this module traces, so nothing finer
 * than this bound is ever lost to it — only the runaway is.
 */
const MIN_LEVEL = -8;

/** How wide a cell is at a level, in degrees. Negative levels are coarser than one degree. */
export function sizeAt(level: number): number {
  return Math.pow(2, -level);
}

/**
 * The level whose cell is about `spacingPx` pixels across.
 *
 * Handed the metres a pixel covers *where the cell will be*, which on a tilted
 * map is not the same up the screen as down it — that difference is what the
 * caller's bands exist to measure.
 *
 * Was floored at 0 — no cell coarser than a degree — which is fine at the
 * zoom this module was built for, but a camera pulled back to show most of
 * the planet covers many degrees per pixel, and the floor stopped the cells
 * from growing to match: `spacingPx` kept asking for a *budget's* worth of
 * lines, and got a whole planet tiled in one-degree cells instead, however
 * many that came to. Letting the level go negative (`MIN_LEVEL` still stops
 * it going *arbitrarily* negative) is what keeps that budget at the source.
 */
export function levelFor(metresPerPixel: number, spacingPx: number, latitude: number): number {
  const metres = Math.max(1e-3, metresPerPixel * Math.max(1, spacingPx));
  const east = METRES_PER_DEGREE * Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const degrees = metres / east;
  return Math.max(MIN_LEVEL, Math.round(Math.log2(1 / degrees)));
}

/**
 * The cell a point falls in.
 *
 * Floors rather than rounds: a point belongs to the cell whose west/south
 * edge it has passed, so a cell's own half-open range
 * `[col*size, (col+1)*size)` is exactly what `sizeAt`'s neighbours tile
 * without gaps or overlap. Rounding would instead put a point in whichever
 * cell was merely nearer, which breaks that tiling and can flip a point
 * between cells on nothing but floating-point noise near a boundary.
 */
export function cellAt(level: number, lon: number, lat: number): Cell {
  const size = sizeAt(level);
  return { level, col: Math.floor(lon / size), row: Math.floor(lat / size) };
}

export function keyOf(cell: Cell): string {
  return `${cell.level}:${cell.col}:${cell.row}`;
}

/** murmur3's finalizer — the avalanche step `hashOf` leans on. */
function fmix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Combines a cell's three integer fields into one well-mixed hash.
 *
 * A single XOR-then-multiply per field (this module's first version) is close
 * to an affine map: incrementing one coordinate by one — exactly what a
 * neighbouring cell does — moves the hash by a near-constant delta instead
 * of scattering it, so adjacent cells got near-identical seeds and phases and
 * the field drew the cell lattice instead of hiding it. Running each field
 * through murmur3's finalizer before folding it in gives a single flipped
 * input bit roughly even odds of flipping any given output bit, which an
 * affine map cannot do.
 */
function hashOf(cell: Cell): number {
  let hash = 0;
  for (const value of [cell.level, cell.col, cell.row]) {
    hash = fmix32(hash ^ fmix32(value | 0));
  }
  return hash;
}

/**
 * Two numbers between 0 and 1 from that hash.
 *
 * `seedOf` needs an x and a y that don't move together, or every seed would
 * sit on the same diagonal through its cell. Slicing two different bit
 * ranges out of one already-avalanched hash is enough to decorrelate them
 * without hashing the cell a second time — scattering nearby cells apart is
 * `hashOf`'s job, not this one's.
 */
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

/**
 * Where in the cycle this cell's trail starts, from 0 to 1.
 *
 * Hashed as if the cell sat 101 levels up rather than reusing `seedOf`'s own
 * hash: without that shift this would fold to the same combination `seedOf`
 * uses for the seed's y-offset, so a cell born high up in its own cell would
 * also always be the one that starts late in the cycle — a correlation
 * between where a line is drawn and when it starts that would read as
 * another kind of lattice. 101 is arbitrary; it only has to differ from every
 * level this module is actually asked to work at.
 */
export function phaseOf(cell: Cell): number {
  return pairFrom(hashOf({ ...cell, level: cell.level + 101 }))[0];
}
