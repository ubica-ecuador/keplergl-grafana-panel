import { arrowGlyph, CELL, Glyph } from './vectorFieldGlyphs';

/**
 * The shapes this plugin draws itself, as geometry.
 *
 * Geometry rather than pixels for the same reason the wind barbs are: what can
 * be wrong — where a glyph is anchored, whether it closes — is testable without
 * a canvas, and jest has none.
 *
 * Every glyph points north in its cell; the layer turns it on the map.
 */

const MID = CELL / 2;

/** One icon of kepler's own library: a flat, triangulated outline. */
export interface KeplerIcon {
  id: string;
  mesh: { positions: number[][]; cells: number[][] };
}

/** The glyph drawn when a saved config names one this build does not have. */
export const SYMBOL_FALLBACK = 'arrow';

/**
 * kepler's icons as glyphs of this atlas.
 *
 * They arrive as 2-D meshes — positions normalised to [-1, 1] with z always
 * zero, and triangles indexing them — so each triangle becomes a filled polygon
 * of the cell. Filling the triangles of a triangulation paints the same solid
 * shape the outline would, and needs nothing our painter does not already do.
 *
 * The y axis is flipped: a mesh grows upwards, a canvas downwards.
 */
export function meshGlyphs(icons: KeplerIcon[]): Glyph[] {
  return icons.map((icon) => ({
    key: icon.id,
    anchor: [MID, MID] as [number, number],
    shapes: icon.mesh.cells.map((cell) => ({
      kind: 'polygon' as const,
      points: cell.map((index) => {
        const [x, y] = icon.mesh.positions[index];
        return [round(MID + x * MID), round(MID - y * MID)] as [number, number];
      }),
    })),
  }));
}

/** Atlas pixels, to a hundredth: enough to draw, short enough to compare in a test. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function ownGlyphs(): Glyph[] {
  return [
    arrowGlyph(),
    { key: 'circle', anchor: [MID, MID], shapes: [{ kind: 'circle', centre: [MID, MID], radius: 26 }] },
    {
      key: 'square',
      anchor: [MID, MID],
      shapes: [{ kind: 'polygon', points: [[22, 22], [74, 22], [74, 74], [22, 74]] }],
    },
    {
      key: 'triangle',
      anchor: [MID, MID],
      shapes: [{ kind: 'polygon', points: [[MID, 18], [76, 74], [20, 74]] }],
    },
    {
      key: 'chevron',
      anchor: [MID, MID],
      shapes: [{ kind: 'line', points: [[24, 62], [MID, 30], [72, 62]] }],
    },
    {
      key: 'pin',
      // Driven into the ground at the bottom of the cell, like a barb's station.
      anchor: [MID, 92],
      shapes: [
        { kind: 'line', points: [[MID, 92], [MID, 44]] },
        { kind: 'circle', centre: [MID, 30], radius: 16 },
      ],
    },
    {
      key: 'cross',
      anchor: [MID, MID],
      shapes: [
        { kind: 'line', points: [[26, 26], [70, 70]] },
        { kind: 'line', points: [[70, 26], [26, 70]] },
      ],
    },
  ];
}
