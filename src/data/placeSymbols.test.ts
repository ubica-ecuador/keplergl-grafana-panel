import { WindField } from './buildWindField';
import { bearingOf, onDataCells, onScreenGrid } from './placeSymbols';
import type { ScreenCamera } from './traceStreamlines';

/** A field with the same velocity everywhere, spanning ±10°. */
const uniform = (u: number, v: number): WindField => ({
  data: Float32Array.from([u, v, u, v, u, v, u, v]),
  columns: 2,
  rows: 2,
  west: -10,
  south: -10,
  stepLon: 20,
  stepLat: 20,
});

type Box = { west: number; east: number; south: number; north: number };

/** A camera looking straight down at a box, 800 × 400 px. */
const cameraOver = (box: Box, sky: (y: number) => boolean = () => false): ScreenCamera => ({
  widthPx: 800,
  heightPx: 400,
  bounds: box,
  metresPerPixel: 1000,
  unproject: (x, y) =>
    sky(y) ? null : [box.west + (x / 800) * (box.east - box.west), box.north - (y / 400) * (box.north - box.south)],
});

describe('onScreenGrid', () => {
  it('puts one symbol in the middle of every cell of the screen', () => {
    // 800 × 400 in cells of 100 is 8 × 4. The first centre is pixel (50, 50),
    // which over a 16° × 8° box is one degree in from the west and the north.
    const placed = onScreenGrid(uniform(3, 4), cameraOver({ west: -8, east: 8, south: -4, north: 4 }), 100);

    expect(placed).toHaveLength(32);
    expect(placed[0].lng).toBeCloseTo(-7, 6);
    expect(placed[0].lat).toBeCloseTo(3, 6);
    expect(placed[0].speed).toBeCloseTo(5, 6);
  });

  it('skips the pixels that show sky', () => {
    // The top half of the screen, rows at y = 50 and 150, sees no ground.
    const camera = cameraOver({ west: -8, east: 8, south: -4, north: 4 }, (y) => y < 200);

    expect(onScreenGrid(uniform(3, 4), camera, 100)).toHaveLength(16);
  });

  it('skips the ground outside the field', () => {
    // Longitude runs 0–32° across the screen; the field stops at 10°, which
    // only the first three columns of centres (2°, 6°, 10°) reach.
    const placed = onScreenGrid(uniform(3, 4), cameraOver({ west: 0, east: 32, south: -4, north: 4 }), 100);

    expect(placed).toHaveLength(12);
  });

  it('skips screen cells that fall over a hole in the data', () => {
    // 3 columns × 2 rows: two column-cells, west (lng -12..0) and east
    // (lng 0..12), each spanning the full latitude range because with only
    // two rows `sampleWindField` always interpolates between them. The NaN
    // sits at the field's own corner (col 0, row 0), which belongs only to
    // the west cell — the east one references none of it and stays whole.
    const field: WindField = {
      data: Float32Array.from([NaN, NaN, 3, 3, 5, 5, 2, 2, 4, 4, 6, 6]),
      columns: 3,
      rows: 2,
      west: -12,
      south: -5,
      stepLon: 12,
      stepLat: 10,
    };
    const camera = cameraOver({ west: -12, east: 12, south: -5, north: 5 });

    // Spacing 400 over an 800 × 400 camera gives exactly two candidate
    // centres: x = 200 (lng -6, inside the holed west cell) and x = 600
    // (lng 6, inside the intact east cell). Only the second survives.
    const placed = onScreenGrid(field, camera, 400);

    expect(placed).toHaveLength(1);
    expect(placed[0].lng).toBeCloseTo(6, 6);
  });
});

describe('onDataCells', () => {
  it('puts one symbol on every node that has a velocity', () => {
    const field: WindField = {
      data: Float32Array.from([1, 0, NaN, NaN, 0, 2, 3, 4]),
      columns: 2,
      rows: 2,
      west: -10,
      south: -10,
      stepLon: 20,
      stepLat: 20,
    };

    const placed = onDataCells(field);

    // The hole at the second node is no calm air, and gets no symbol.
    expect(placed).toHaveLength(3);
    expect(placed[1]).toEqual({ lng: -10, lat: 10, u: 0, v: 2, speed: 2 });
  });
});

describe('bearingOf', () => {
  it('turns a velocity into the compass bearing it points to', () => {
    expect(bearingOf(10, 0)).toBeCloseTo(90, 6);
    expect(bearingOf(0, 10)).toBeCloseTo(0, 6);
    expect(bearingOf(-10, 0)).toBeCloseTo(270, 6);
    expect(bearingOf(0, -10)).toBeCloseTo(180, 6);
  });
});
