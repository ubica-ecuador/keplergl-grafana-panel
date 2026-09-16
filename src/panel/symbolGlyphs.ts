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

/** The glyph drawn when a saved config names one this build does not have. */
export const SYMBOL_FALLBACK = 'arrow';

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
