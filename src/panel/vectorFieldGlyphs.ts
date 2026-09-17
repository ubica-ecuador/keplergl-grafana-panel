import { barbIconKey, barbParts, MAX_BARB_KNOTS } from './windBarb';

/**
 * The symbols a vector field draws, as geometry, and their painting into one
 * image deck can read icons from.
 *
 * Geometry first and pixels second so the part that can be wrong — which side a
 * barb flies on, how many pennants — is testable without a canvas: jest has
 * none, and `jest-setup.js` leaves `getContext` returning nothing.
 *
 * Every glyph is white on transparent and mapped with `mask: true`, so deck
 * tints it with `getColor` — one atlas for every colour ramp.
 */

/** The side of one square glyph cell, in atlas pixels. */
export const CELL = 96;

/** Glyph cells per atlas row. */
export const ATLAS_COLUMNS = 10;

const MID = CELL / 2;

/** Where a barb's staff starts: the station, at the bottom of the cell. */
const STATION: [number, number] = [MID, 92];

/** Where the staff ends and the feathers begin. */
const TIP_Y = 18;

export type Shape =
  | { kind: 'line' | 'polygon'; points: Array<[number, number]> }
  | { kind: 'circle'; centre: [number, number]; radius: number };

export interface Glyph {
  key: string;
  /** The pixel of the cell that sits on the symbol's place on the map. */
  anchor: [number, number];
  shapes: Shape[];
}

/** One icon's cell in the atlas, in the shape deck's `iconMapping` takes. */
export interface IconFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  mask: true;
}

/** The part of a canvas 2D context the painting uses. */
export interface Painter {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  stroke(): void;
  fill(): void;
}

/**
 * The arrow, calm, and a barb for every five knots up to the cap, in a northern
 * and a southern version.
 *
 * Every glyph points north in its cell; the layer turns it on the map. An arrow
 * points the way the flow goes. A barb's staff points where the wind comes
 * *from*, with its feathers at that far end.
 */
export function glyphCatalogue(): Glyph[] {
  const glyphs: Glyph[] = [arrowGlyph(), calmGlyph()];
  for (let knots = 5; knots <= MAX_BARB_KNOTS; knots += 5) {
    const parts = barbParts(knots);
    for (const southern of [false, true]) {
      glyphs.push({ key: barbIconKey(parts, southern), anchor: STATION, shapes: barbShapes(parts, southern ? -1 : 1) });
    }
  }
  return glyphs;
}

export function arrowGlyph(): Glyph {
  return {
    key: 'arrow',
    anchor: [MID, MID],
    shapes: [
      { kind: 'line', points: [[MID, 78], [MID, 24]] },
      { kind: 'polygon', points: [[MID, 10], [36, 30], [60, 30]] },
    ],
  };
}

function calmGlyph(): Glyph {
  return { key: 'calm', anchor: [MID, MID], shapes: [{ kind: 'circle', centre: [MID, MID], radius: 10 }] };
}

/**
 * The staff and its feathers, pennants first from the far end.
 *
 * `side` is +1 north of the equator and −1 south. With the staff pointing into
 * the wind, the WMO puts the feathers on the side of low pressure — to the left
 * of someone with the wind at their back — which is east of a north-pointing
 * staff in the northern hemisphere and west of it in the southern.
 */
function barbShapes(parts: ReturnType<typeof barbParts>, side: 1 | -1): Shape[] {
  const shapes: Shape[] = [{ kind: 'line', points: [STATION, [MID, TIP_Y]] }];
  let y = TIP_Y;
  for (let i = 0; i < parts.pennants; i++) {
    shapes.push({ kind: 'polygon', points: [[MID, y], [MID + side * 30, y], [MID, y + 9]] });
    y += 11;
  }
  for (let i = 0; i < parts.full; i++) {
    shapes.push({ kind: 'line', points: [[MID, y], [MID + side * 30, y - 12]] });
    y += 8;
  }
  if (parts.half) {
    // A lone half barb is set in from the tip, or it reads as a full one.
    if (parts.pennants === 0 && parts.full === 0) {
      y += 8;
    }
    shapes.push({ kind: 'line', points: [[MID, y], [MID + side * 15, y - 6]] });
  }
  return shapes;
}

export function atlasSize(count: number, columns = ATLAS_COLUMNS): { width: number; height: number } {
  return { width: columns * CELL, height: Math.ceil(count / columns) * CELL };
}

/** Paints one glyph into the cell whose top-left corner is (x, y). */
export function drawGlyph(glyph: Glyph, ctx: Painter, x: number, y: number): void {
  for (const shape of glyph.shapes) {
    ctx.beginPath();
    if (shape.kind === 'circle') {
      ctx.arc(x + shape.centre[0], y + shape.centre[1], shape.radius, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    shape.points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px, y + py) : ctx.lineTo(x + px, y + py)));
    if (shape.kind === 'polygon') {
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

/** Paints the glyphs into a context, row by row, and maps each key to its cell. */
export function paintAtlas<T extends Glyph>(
  glyphs: T[],
  ctx: Painter,
  columns = ATLAS_COLUMNS,
  draw: (glyph: T, ctx: Painter, x: number, y: number) => void = drawGlyph as (
    glyph: T,
    ctx: Painter,
    x: number,
    y: number
  ) => void
): Record<string, IconFrame> {
  const mapping: Record<string, IconFrame> = {};
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  glyphs.forEach((glyph, index) => {
    const x = (index % columns) * CELL;
    const y = Math.floor(index / columns) * CELL;
    draw(glyph, ctx, x, y);
    mapping[glyph.key] = { x, y, width: CELL, height: CELL, anchorX: glyph.anchor[0], anchorY: glyph.anchor[1], mask: true };
  });

  return mapping;
}

/**
 * Creates a canvas sized and ready for painting an atlas, or null if a 2D
 * context is not available.
 *
 * Both symbol and vector field layers use this to create their atlases. Returns
 * null rather than throwing when there is no 2D context to paint into — a
 * browser out of canvas contexts, say. Nothing is cached on that path, so the
 * next call tries again rather than remembering the failure.
 */
export function createAtlasCanvas(count: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const { width, height } = atlasSize(count);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  return { canvas, ctx };
}
