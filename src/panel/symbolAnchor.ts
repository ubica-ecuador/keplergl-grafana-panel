/**
 * Which point of a symbol sits on its row's position, and which point it turns
 * about.
 *
 * Pure, like the glyph geometry: the box a symbol fills and the two settings
 * in, the pixels deck pins and pushes out. `symbolLayer.ts` decides with it,
 * `symbolDeckLayer.ts` measures the box a shape fills, and `pictureKeys.ts`
 * places a picture with it.
 *
 * deck turns an icon about its anchor and nothing else: the anchor is pinned to
 * the position, and the icon is rotated about it before a pixel offset, which
 * is not rotated, is added. So turning about the anchor is deck's own way, and
 * turning about the centre is the centre pinned instead, pushed back by the
 * offset from the anchor to the centre — the same place unturned, a different
 * pivot turned.
 */

/** The nine points of a symbol's box, in the order the panel offers them. */
export const SYMBOL_ANCHORS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;

export type SymbolAnchor = (typeof SYMBOL_ANCHORS)[number];

/** What a symbol turns about: the point on the position, or the middle of what is drawn. */
export const TURN_ABOUT = ['anchor', 'centre'] as const;

export type TurnAbout = (typeof TURN_ABOUT)[number];

export function symbolAnchorOf(value: unknown): SymbolAnchor {
  return (SYMBOL_ANCHORS as readonly unknown[]).includes(value) ? (value as SymbolAnchor) : 'center';
}

export function turnAboutOf(value: unknown): TurnAbout {
  return value === 'centre' ? 'centre' : 'anchor';
}

/** Where an anchor sits along each side of a box: 0 at the left or top, 1 at the right or bottom. */
export function anchorFractions(anchor: SymbolAnchor): [number, number] {
  const x =
    anchor === 'left' || anchor.endsWith('-left') ? 0 : anchor === 'right' || anchor.endsWith('-right') ? 1 : 0.5;
  const y =
    anchor === 'top' || anchor.startsWith('top-') ? 0 : anchor === 'bottom' || anchor.startsWith('bottom-') ? 1 : 0.5;
  return [x, y];
}

/** What a symbol fills of its cell, in cell pixels; right and bottom one past the last pixel. */
export interface InkBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The whole of a square cell, for a symbol whose extent is the cell's. */
export function cellBox(side: number): InkBox {
  return { left: 0, top: 0, right: side, bottom: side };
}

export interface Placement {
  /** The pixel of the cell deck pins to the position and turns the symbol about. */
  pivot: [number, number];
  /**
   * From the anchor to the pivot, in cell pixels with y down: the push, as a
   * pixel offset, that puts the anchor back on the position. Zero when the
   * symbol turns about its anchor.
   */
  shift: [number, number];
  /** From the anchor to the middle of the box, in cell pixels with y down: what labels are set about. */
  lift: [number, number];
}

/**
 * Where a symbol filling `box` is pinned, for an anchor and a pivot.
 *
 * The centre keeps the point the glyph was drawn to sit on, `own`: the cell's
 * centre for nearly every glyph, the tip of a pin for a pin. Every other
 * anchor is a point of the box itself, not of the cell round it, so a shape
 * standing on its bottom stands on its own edge rather than on the empty
 * margin of its cell.
 *
 * Labels are set about the middle of the box, except at the centre, where
 * they stay about the point as they always were.
 */
export function placeIn(box: InkBox, own: [number, number], anchor: SymbolAnchor, turnAbout: TurnAbout): Placement {
  const [fx, fy] = anchorFractions(anchor);
  const at: [number, number] =
    anchor === 'center' ? own : [box.left + fx * (box.right - box.left), box.top + fy * (box.bottom - box.top)];
  const middle: [number, number] = [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
  const pivot = turnAbout === 'centre' ? middle : at;
  return {
    pivot,
    shift: [pivot[0] - at[0], pivot[1] - at[1]],
    lift: anchor === 'center' ? [0, 0] : [middle[0] - at[0], middle[1] - at[1]],
  };
}

/** The alpha a pixel needs to count as drawn: an antialiased fringe fainter than this is left out. */
const INK_ALPHA = 32;

/**
 * The box a cell's drawn pixels fill, read from an atlas's RGBA bytes, in
 * pixels of the cell; null for a cell with nothing drawn.
 *
 * Measured, not computed: the icon libraries' outlines are SVG paths, curves
 * included, and their view boxes leave margins of their own. The pixels are
 * what is drawn, whatever drew them.
 */
export function inkBoxIn(
  rgba: ArrayLike<number>,
  atlasWidth: number,
  cell: { x: number; y: number; width: number; height: number }
): InkBox | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < cell.height; y++) {
    const rowStart = ((cell.y + y) * atlasWidth + cell.x) * 4;
    for (let x = 0; x < cell.width; x++) {
      if (rgba[rowStart + x * 4 + 3] >= INK_ALPHA) {
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  return right > left ? { left, top, right, bottom } : null;
}

/**
 * The pixel offset that keeps a symbol's anchor on its position while it turns
 * about another point, per row: `shift` cell pixels scaled the way deck scales
 * the icon, to the row's size over the cell's side, and by the zoom's
 * shrinking — deck applies its `sizeScale` to the icon but not to an offset.
 *
 * Null when there is nothing to push, so the layer passes no accessor at all.
 */
export function pivotOffset(
  shift: [number, number],
  cellSide: number,
  sizeOf: (row: unknown) => number,
  sizeFactor = 1
): ((row: unknown) => [number, number]) | null {
  if (shift[0] === 0 && shift[1] === 0) {
    return null;
  }
  return (row: unknown) => {
    const scale = (Number(sizeOf(row)) * sizeFactor) / cellSide || 0;
    return [shift[0] * scale, shift[1] * scale];
  };
}
